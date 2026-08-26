// SORCE Tools — internal/limited-release tooling.
//
// Everything here sits behind users.feature_tools_enabled, which is false by default
// and switched on per account. The gate is enforced HERE, not just by hiding the tab:
// each mockup run costs real money at two providers, so an endpoint that only the UI
// hides is an open invitation.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { generateWrapBrief } = require('../utils/wrapDesignBrief');
const { renderBaseVehicle, paintWrap, WrapImageError } = require('../utils/wrapMockupImages');
const { extractBrandColors } = require('../utils/brandColors');

// Artwork is small; memory storage avoids writing to Railway's ephemeral disk.
// Up to MAX_ARTWORK images: a logo plus a couple of real job photos is the useful case,
// and every extra image is more tokens on each of the three paint calls.
const MAX_ARTWORK = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_ARTWORK },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) cb(null, true);
    else cb(new Error('Artwork must be an image'));
  },
});

// A mockup run is three image generations. This is a spend guard, not a licence check.
const RUNS_PER_DAY = 25;

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Gate. Defaults to closed, so a new account never silently gets access. */
async function requireToolsAccess(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT feature_tools_enabled FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows[0]?.feature_tools_enabled !== true) {
      return res.status(403).json({ error: 'Tools are not enabled for this account', code: 'TOOLS_DISABLED' });
    }
    next();
  } catch (error) {
    console.error('Tools access check failed:', error.message);
    res.status(500).json({ error: 'Failed to verify access' });
  }
}

// GET /api/tools/access - Does this account see the Tools tab at all?
// Deliberately only behind authenticateToken so the dashboard can ask without a 403
// in the console on every page load for everyone else.
router.get('/access', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT feature_tools_enabled FROM users WHERE id = $1',
      [req.user.userId]
    );
    res.json({ enabled: result.rows[0]?.feature_tools_enabled === true });
  } catch (error) {
    console.error('Tools access lookup failed:', error.message);
    res.json({ enabled: false });
  }
});

// POST /api/tools/wrap-mockup - Generate three wrap concepts on the customer's vehicle.
// multipart/form-data so the optional logo can ride along with the fields.
router.post(
  '/wrap-mockup',
  authenticateToken,
  requireToolsAccess,
  upload.array('images', MAX_ARTWORK),
  async (req, res) => {
    const userId = req.user.userId;
    try {
      const {
        businessName, service, tagline, phone, website,
        primaryColor, accentColor,
        year, make, model, trim,
        customerEmail, autoColors, designMode,
      } = req.body || {};

      if (!businessName?.trim()) return res.status(400).json({ error: 'Business name is required' });
      // service is optional on purpose — the trade is read off the name and logo. Only the
      // name and the vehicle are genuinely needed.
      if (!year || !make?.trim() || !model?.trim()) {
        return res.status(400).json({ error: 'Vehicle year, make and model are required' });
      }
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        return res.status(500).json({ error: 'Image hosting is not configured on the server' });
      }

      const rate = await pool.query(
        `SELECT COUNT(*)::int AS n FROM wrap_mockups
          WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [userId]
      );
      if (rate.rows[0].n >= RUNS_PER_DAY) {
        return res.status(429).json({
          error: `Daily limit of ${RUNS_PER_DAY} mockup runs reached. Try again tomorrow.`,
          code: 'RATE_LIMITED',
        });
      }

      const vehicle = [year, make, model, trim].filter(Boolean).join(' ');
      const artwork = req.files || [];

      configureCloudinary();
      // Returns the whole Cloudinary result, because the artwork uploads need `colors`
      // off it as well as the URL.
      const uploadBuffer = (buffer, publicId, opts = {}) => new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `sorce/wrap-mockups/${userId}`,
            public_id: publicId,
            resource_type: 'image',
            ...opts,
          },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(buffer);
      });

      const stamp = Date.now();

      // 1. Artwork first, with colour extraction on. Cloudinary does the palette work,
      //    which avoids a native image dependency (sharp/canvas) in this project.
      const artworkUploads = [];
      const colorArrays = [];
      for (let i = 0; i < artwork.length; i++) {
        const file = artwork[i];
        try {
          const result = await uploadBuffer(file.buffer, `${stamp}-artwork-${i}`, { colors: true });
          artworkUploads.push({ url: result.secure_url, name: file.originalname });
          if (Array.isArray(result.colors)) colorArrays.push(result.colors);
        } catch (err) {
          // Artwork is an input, not the deliverable — a failed upload shouldn't sink
          // the run. The file is still passed to the image model from memory below.
          console.error(`[wrap-mockup] artwork ${i} upload failed: ${err.message}`);
        }
      }

      // 2. Brand colours from the artwork, falling back to whatever the form had.
      //    extractBrandColors returns null for black-and-white artwork rather than
      //    handing back grey, so the manual values survive that case.
      const detected = colorArrays.length > 0 ? extractBrandColors(colorArrays) : null;
      const useDetected = autoColors !== 'false' && !!detected;
      const resolvedColors = {
        primary: useDetected ? detected.primary : (primaryColor || '#FF6B1A'),
        accent: useDetected ? detected.accent : (accentColor || '#FFC53D'),
        source: useDetected ? 'artwork' : 'manual',
        palette: detected?.palette || [],
        accentDerived: useDetected ? !!detected.accentDerived : false,
      };

      const references = artwork.map(file => ({
        buffer: file.buffer,
        mimeType: file.mimetype,
        label: file.originalname || 'artwork',
      }));

      // 3. The creative decisions. Claude is shown the artwork itself, so it reads the
      //    trade, the palette and the brand's character rather than being told them.
      const brief = await generateWrapBrief({
        businessName,
        service: service?.trim() || undefined,
        tagline: tagline?.trim() || undefined,
        phone, website,
        primaryColor: resolvedColors.primary,
        accentColor: resolvedColors.accent,
        vehicle,
        // 'evolve' respects what they already have; 'reinvent' starts over. Default bold,
        // since a business asking for a mockup usually wants to see something better.
        designMode: designMode === 'evolve' ? 'evolve' : 'reinvent',
      }, userId, references);

      // 4. One base photo, reused for all three variants. Generating a fresh vehicle per
      //    variant would give three different vans, which defeats comparing designs.
      const baseImage = await renderBaseVehicle({ year, make, model, trim });
      const sourcePhotoUrl = (await uploadBuffer(baseImage, `${stamp}-base`)).secure_url;

      // 5. Paint each variant. Sequential on purpose — the image model is the slow,
      //    rate-limited step, and a partial set is more useful than a 429 storm.
      const variants = [];
      const failures = [];
      for (const variant of brief.variants) {
        try {
          const painted = await paintWrap({ baseImage, imagePrompt: variant.image_prompt, references });
          const uploaded = await uploadBuffer(painted, `${stamp}-${variant.id}`);
          variants.push({
            id: variant.id,
            label: variant.label,
            rationale: variant.rationale,
            imageUrl: uploaded.secure_url,
          });
        } catch (err) {
          console.error(`[wrap-mockup] variant ${variant.id} failed: ${err.message}`);
          failures.push({ id: variant.id, label: variant.label, error: err.message });
        }
      }

      if (variants.length === 0) {
        return res.status(502).json({
          error: 'Every variant failed to render. Nothing was saved.',
          detail: failures[0]?.error,
        });
      }

      const saved = await pool.query(
        `INSERT INTO wrap_mockups
           (user_id, business_name, vehicle, source_photo_url, variants, creative_summary,
            dominant_message, customer_email, artwork_urls, brand_colors)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, created_at`,
        [userId, businessName.trim(), vehicle, sourcePhotoUrl, JSON.stringify(variants),
         brief.creative_summary || null,
         [brief.inferred_trade, brief.dominant_message].filter(Boolean).join(' — ') || null,
         customerEmail?.trim() || null,
         JSON.stringify(artworkUploads), JSON.stringify(resolvedColors)]
      );

      res.json({
        mockupId: saved.rows[0].id,
        createdAt: saved.rows[0].created_at,
        vehicle,
        creativeSummary: brief.creative_summary,
        dominantMessage: brief.dominant_message,
        inferredTrade: brief.inferred_trade,
        brandRead: brief.brand_read,
        brandWarning: brief.brand_warning || undefined,
        ctaType: brief.cta_type,
        designMode: designMode === 'evolve' ? 'evolve' : 'reinvent',
        sourcePhotoUrl,
        variants,
        // So the UI can show which colours were actually used and pre-fill the pickers.
        brandColors: resolvedColors,
        artwork: artworkUploads,
        // Reported rather than hidden — three concepts were promised, and the UI says
        // so when fewer came back.
        partial: failures.length > 0 ? failures : undefined,
      });
    } catch (error) {
      if (error instanceof WrapImageError) {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      console.error('[wrap-mockup] failed:', error.message);
      res.status(500).json({ error: 'Failed to generate mockups', detail: error.message });
    }
  }
);

// GET /api/tools/wrap-mockups - Previous runs, so a concept can be re-sent later.
router.get('/wrap-mockups', authenticateToken, requireToolsAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, business_name, vehicle, source_photo_url, variants,
              creative_summary, dominant_message, customer_email, created_at,
              artwork_urls, brand_colors
         FROM wrap_mockups WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 40`,
      [req.user.userId]
    );
    res.json({ mockups: result.rows });
  } catch (error) {
    console.error('Failed to list wrap mockups:', error.message);
    res.status(500).json({ error: 'Failed to load mockups' });
  }
});

module.exports = router;
