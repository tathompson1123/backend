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

// Logos are small; memory storage avoids writing to Railway's ephemeral disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) cb(null, true);
    else cb(new Error('Logo must be an image'));
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
  upload.single('logo'),
  async (req, res) => {
    const userId = req.user.userId;
    try {
      const {
        businessName, service, tagline, phone, website,
        primaryColor, accentColor,
        year, make, model, trim,
        customerEmail,
      } = req.body || {};

      if (!businessName?.trim()) return res.status(400).json({ error: 'Business name is required' });
      if (!service?.trim()) return res.status(400).json({ error: 'A primary service is required' });
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

      // 1. The creative decisions — which message leads, and how each variant differs.
      const brief = await generateWrapBrief({
        businessName, service, tagline, phone, website,
        primaryColor, accentColor, vehicle,
        hasLogo: !!req.file,
      }, userId);

      // 2. One base photo, reused for all three variants. Generating a fresh vehicle per
      //    variant would give three different vans, which defeats comparing designs.
      const baseImage = await renderBaseVehicle({ year, make, model, trim });
      const logo = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : null;

      configureCloudinary();
      const uploadBuffer = (buffer, publicId) => new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `sorce/wrap-mockups/${userId}`, public_id: publicId, resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result.secure_url))
        );
        stream.end(buffer);
      });

      const stamp = Date.now();
      const sourcePhotoUrl = await uploadBuffer(baseImage, `${stamp}-base`);

      // 3. Paint each variant. Sequential on purpose — the image model is the slow,
      //    rate-limited step, and a partial set is more useful than a 429 storm.
      const variants = [];
      const failures = [];
      for (const variant of brief.variants) {
        try {
          const painted = await paintWrap({ baseImage, imagePrompt: variant.image_prompt, logo });
          variants.push({
            id: variant.id,
            label: variant.label,
            rationale: variant.rationale,
            imageUrl: await uploadBuffer(painted, `${stamp}-${variant.id}`),
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
            dominant_message, customer_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [userId, businessName.trim(), vehicle, sourcePhotoUrl, JSON.stringify(variants),
         brief.creative_summary || null, brief.dominant_message || null,
         customerEmail?.trim() || null]
      );

      res.json({
        mockupId: saved.rows[0].id,
        createdAt: saved.rows[0].created_at,
        vehicle,
        creativeSummary: brief.creative_summary,
        dominantMessage: brief.dominant_message,
        sourcePhotoUrl,
        variants,
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
              creative_summary, dominant_message, customer_email, created_at
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
