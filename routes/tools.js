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
const { scrapeSite, fetchImage, ScrapeError } = require('../utils/siteScrape');
const { scanBrand } = require('../utils/brandScan');
const { sniffImageType } = require('../utils/imageType');

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

// A brand scan is a Puppeteer launch plus one vision call — cheaper than a mockup run, but
// it is also the one endpoint here that fetches a URL the caller supplies, so it gets a
// tighter cap of its own rather than sharing the mockup budget.
const SCANS_PER_DAY = 40;

// Wrap copy that the customer supplies. Capped because these are printed on a vehicle:
// past seven services the block stops being readable at 40mph, and the wrap is worse for
// having them.
const MAX_SERVICES = 7;
const MAX_BADGES = 6;

/**
 * A list field off multipart/form-data. The frontend sends JSON, but a form post or a
 * curl call reasonably sends "a, b, c" — accept both rather than silently dropping the
 * content that makes a dense wrap possible.
 */
function parseList(raw, limit) {
  if (!raw) return [];
  let items = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) {
      try { items = JSON.parse(text); } catch { items = text.split(','); }
    } else {
      items = text.split(',');
    }
  }
  return items
    .map(s => String(s == null ? '' : s).trim())
    .filter(Boolean)
    .slice(0, limit);
}

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
        customerEmail, autoColors, designMode, designIntensity,
        services, badges, serviceArea, yearsInBusiness, socialHandle,
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

      // 'evolve' respects what they already have; 'reinvent' starts over. Default bold,
      // since a business asking for a mockup usually wants to see something better.
      const mode = designMode === 'evolve' ? 'evolve' : 'reinvent';
      // Orthogonal to designMode: one is how far to depart, the other how loud to be.
      // 'bold' is the dense trade-truck treatment, 'simple' the restrained premium one.
      const intensity = designIntensity === 'simple' ? 'simple' : 'bold';

      // 3. What the customer actually wants printed. This is the input that decides whether
      //    a wrap looks full or sparse: with no services and no badges the design has
      //    nothing to fill panels with, and neither Claude nor the image model may invent
      //    them, because they would be printing claims the business never made.
      const wrapContent = {
        services: parseList(services, MAX_SERVICES),
        badges: parseList(badges, MAX_BADGES),
        serviceArea: serviceArea?.trim() || undefined,
        yearsInBusiness: yearsInBusiness?.trim() || undefined,
        socialHandle: socialHandle?.trim() || undefined,
      };

      // 4. The creative decisions. Claude is shown the artwork itself, so it reads the
      //    trade, the palette and the brand's character rather than being told them.
      const brief = await generateWrapBrief({
        businessName,
        service: service?.trim() || undefined,
        tagline: tagline?.trim() || undefined,
        phone, website,
        primaryColor: resolvedColors.primary,
        accentColor: resolvedColors.accent,
        vehicle,
        designMode: mode,
        designIntensity: intensity,
        content: wrapContent,
      }, userId, references);

      // 5. One base sheet — side, front and rear of the same blank vehicle — reused for all
      //    three variants. Generating a fresh vehicle per variant would give three different
      //    vans, which defeats comparing designs.
      const baseImage = await renderBaseVehicle({ year, make, model, trim });
      const sourcePhotoUrl = (await uploadBuffer(baseImage, `${stamp}-base`)).secure_url;

      // 6. Paint each variant. Sequential on purpose — the image model is the slow,
      //    rate-limited step, and a partial set is more useful than a 429 storm.
      const variants = [];
      const failures = [];
      for (const variant of brief.variants) {
        try {
          const painted = await paintWrap({
            baseImage,
            imagePrompt: variant.image_prompt,
            references,
            intensity,
          });
          const uploaded = await uploadBuffer(painted, `${stamp}-${variant.id}`);
          variants.push({
            id: variant.id,
            label: variant.label,
            rationale: variant.rationale,
            // The UI already renders these two; they were being dropped here, so the
            // signature and strategy never reached the screen.
            signature: variant.signature,
            color_strategy: variant.color_strategy,
            // The content manifest, so the salesperson can check what will be printed
            // against what the customer actually said before sending it on.
            palette: variant.palette,
            wordmark: variant.wordmark,
            tradeDescriptor: variant.trade_descriptor,
            tagline: variant.tagline || undefined,
            servicesShown: variant.services_shown,
            credentialsShown: variant.credentials_shown,
            phoneDisplay: variant.phone_display || undefined,
            websiteDisplay: variant.website_display || undefined,
            mascot: variant.mascot || undefined,
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
        designMode: mode,
        designIntensity: intensity,
        // Echoed back so the UI can show what was actually used after the caps were applied.
        wrapContent,
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

// POST /api/tools/brand-scan - Read a business's website and prefill the wrap form from it.
//
// Returns a prefill, never a mockup: the salesperson reviews and corrects it before any
// image generation runs. Nothing here is stored — the scan itself is thrown away once the
// response is sent, and only a row in wrap_brand_scans records that it happened, for the
// rate limit. The logo and photo candidates come back as data URLs rather than remote links
// so the frontend can drop them straight into the same file list the manual upload uses,
// with no separate download step and no Cloudinary asset created for a scan nobody acts on.
router.post('/brand-scan', authenticateToken, requireToolsAccess, async (req, res) => {
  const userId = req.user.userId;
  const rawUrl = (req.body?.url || '').trim();
  if (!rawUrl) return res.status(400).json({ error: 'A website address is required' });

  try {
    const rate = await pool.query(
      `SELECT COUNT(*)::int AS n FROM wrap_brand_scans
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    if (rate.rows[0].n >= SCANS_PER_DAY) {
      return res.status(429).json({
        error: `Daily limit of ${SCANS_PER_DAY} site scans reached. Try again tomorrow.`,
        code: 'RATE_LIMITED',
      });
    }

    const site = await scrapeSite(rawUrl);

    // Download the top logo candidates so Claude sees real pixels, not just a URL and an
    // alt tag — that is what lets it distinguish the real mark from a payment badge sitting
    // next to it in the header.
    const logoDownloads = [];
    for (const candidate of site.logos.slice(0, 3)) {
      try {
        const { buffer } = await fetchImage(candidate.src, 3 * 1024 * 1024);
        logoDownloads.push({ index: logoDownloads.length, buffer, meta: candidate });
      } catch (err) {
        console.warn(`[brand-scan] logo candidate download failed: ${err.message}`);
      }
    }

    // Recorded before the Claude call so a slow or failed scan still counts against the
    // limit — the Puppeteer launch is most of the cost either way.
    await pool.query(
      'INSERT INTO wrap_brand_scans (user_id, url) VALUES ($1, $2)',
      [userId, site.finalUrl]
    );

    const scan = await scanBrand(site, logoDownloads, userId);

    // Only the logo Claude actually pointed at goes back — not every candidate that was
    // downloaded, so the form can't be prefilled with a mark the model itself rejected.
    let logo = null;
    if (Number.isInteger(scan.logo_index) && scan.logo_index >= 0) {
      const chosen = logoDownloads[scan.logo_index];
      if (chosen) {
        const mediaType = sniffImageType(chosen.buffer) || 'image/png';
        logo = {
          dataUrl: `data:${mediaType};base64,${chosen.buffer.toString('base64')}`,
          name: (chosen.meta.src.split('/').pop() || 'logo').split('?')[0],
        };
      }
    }

    // Photos are fetched only for the handful of indexes Claude picked, not the whole
    // candidate list — the ranking in siteScrape already narrowed it, this narrows further.
    const photos = [];
    for (const idx of (scan.photo_indexes || []).slice(0, 3)) {
      const candidate = site.photos[idx];
      if (!candidate) continue;
      try {
        const { buffer } = await fetchImage(candidate.src, 4 * 1024 * 1024);
        const mediaType = sniffImageType(buffer) || 'image/jpeg';
        photos.push({
          dataUrl: `data:${mediaType};base64,${buffer.toString('base64')}`,
          name: (candidate.src.split('/').pop() || 'photo').split('?')[0],
        });
      } catch (err) {
        console.warn(`[brand-scan] photo download failed: ${err.message}`);
      }
    }

    res.json({
      sourceUrl: site.finalUrl,
      engine: site.engine,
      businessName: scan.business_name || undefined,
      trade: scan.trade || undefined,
      tagline: scan.tagline || undefined,
      phone: scan.phone || undefined,
      website: scan.website || undefined,
      serviceArea: scan.service_area || undefined,
      yearsInBusiness: scan.years_in_business || undefined,
      socialHandle: scan.social_handle || undefined,
      services: scan.services || [],
      credentials: scan.credentials || [],
      // A preview only — real brand colours are (re)computed from the logo file at generate
      // time via the same Cloudinary extraction manual uploads already go through.
      brandColorsPreview: scan.brand_colors || undefined,
      brandRead: scan.brand_read || undefined,
      missing: scan.missing || [],
      logo,
      photos,
    });
  } catch (error) {
    if (error instanceof ScrapeError) {
      const status = error.code === 'BLOCKED_HOST' ? 400 : 422;
      return res.status(status).json({ error: error.message, code: error.code });
    }
    console.error('[brand-scan] failed:', error.message);
    res.status(500).json({ error: 'Could not read that website', detail: error.message });
  }
});

module.exports = router;
