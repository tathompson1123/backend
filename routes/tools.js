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
const { generateWrapBrief, refineWrapVariant } = require('../utils/wrapDesignBrief');
const { renderBaseVehicle, paintWrap, WrapImageError } = require('../utils/wrapMockupImages');
const { extractBrandColors } = require('../utils/brandColors');
const { scrapeSite, fetchImage, ScrapeError } = require('../utils/siteScrape');
const { scanBrand } = require('../utils/brandScan');
const { sniffImageType } = require('../utils/imageType');

// Artwork is small; memory storage avoids writing to Railway's ephemeral disk.
// Up to MAX_ARTWORK images: a logo plus a couple of real job photos is the useful case,
// and every extra image is more tokens on each of the two paint calls.
const MAX_ARTWORK = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_ARTWORK },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) cb(null, true);
    else cb(new Error('Artwork must be an image'));
  },
});

// A mockup run is the base sheet plus two painted variants — three Gemini calls total,
// plus one Claude brief call. This is a spend guard, not a licence check.
const RUNS_PER_DAY = 200;

// A brand scan is a Puppeteer launch plus one vision call — cheaper than a mockup run, but
// it is also the one endpoint here that fetches a URL the caller supplies, so it gets a
// tighter cap of its own rather than sharing the mockup budget.
const SCANS_PER_DAY = 40;

// A refinement is one Claude call plus one Gemini call — cheaper than a full run (which is
// one Claude call plus three Gemini calls), so it gets its own, more generous budget rather
// than sharing RUNS_PER_DAY.
const REFINEMENTS_PER_DAY = 150;

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

/**
 * A Cloudinary upload closure scoped to one user's folder — shared by the generate and
 * refine endpoints rather than redefined in each. Returns the whole Cloudinary result,
 * because a caller sometimes needs `colors` off it as well as the URL.
 */
function makeUploader(userId) {
  return (buffer, publicId, opts = {}) => new Promise((resolve, reject) => {
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

// POST /api/tools/wrap-mockup - Generate two wrap concepts on the customer's vehicle.
// multipart/form-data so the optional logo can ride along with the fields.
router.post(
  '/wrap-mockup',
  authenticateToken,
  requireToolsAccess,
  upload.array('images', MAX_ARTWORK),
  async (req, res) => {
    const userId = req.user.userId;
    // Declared outside the try so the catch block can mark an in-progress reservation
    // failed rather than leaving it stuck at 'generating' when something throws before the
    // run reaches its normal failure/success updates.
    let mockupId = null;
    try {
      const {
        businessName, service, tagline, phone, website,
        primaryColor, accentColor,
        year, make, model, trim,
        customerEmail, autoColors, designMode, designIntensity, wrapCoverage,
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

      // Reserve the row now, before any paid work starts, not once the run finishes. The
      // rate check above only sees rows that already exist — queuing several runs before
      // the first one lands used to let every one of them past the same, already-stale
      // count. A reservation closes that window; the run is updated in place below instead
      // of inserted fresh.
      const reservation = await pool.query(
        `INSERT INTO wrap_mockups (user_id, business_name, vehicle, customer_email, status)
         VALUES ($1, $2, $3, $4, 'generating')
         RETURNING id, created_at`,
        [userId, businessName.trim(), vehicle, customerEmail?.trim() || null]
      );
      mockupId = reservation.rows[0].id;
      const createdAt = reservation.rows[0].created_at;

      configureCloudinary();
      const uploadBuffer = makeUploader(userId);

      const stamp = Date.now();

      // 1. Artwork first, with colour extraction on. Cloudinary does the palette work,
      //    which avoids a native image dependency (sharp/canvas) in this project.
      //
      //    SVG artwork gets rasterized here too, in the same upload call: neither Claude's
      //    vision nor Gemini's image endpoint accepts SVG as image input ("Unsupported MIME
      //    type: image/svg+xml"), and a vector logo is common, not an edge case — it is the
      //    default export format for most modern logo design, and the site-scan feature
      //    feeds real-world logos into this exact path. Passing format: 'png' on upload
      //    tells Cloudinary to rasterize a vector source rather than just relabel it, so
      //    the bytes fetched back from secure_url afterward are a genuine PNG.
      const artworkUploads = [];
      const colorArrays = [];
      const references = [];
      for (let i = 0; i < artwork.length; i++) {
        const file = artwork[i];
        const isSvg = sniffImageType(file.buffer) === 'image/svg+xml';
        try {
          const result = await uploadBuffer(file.buffer, `${stamp}-artwork-${i}`, {
            colors: true,
            ...(isSvg ? { format: 'png' } : {}),
          });
          artworkUploads.push({ url: result.secure_url, name: file.originalname });
          if (Array.isArray(result.colors)) colorArrays.push(result.colors);

          if (isSvg) {
            const rasterRes = await fetch(result.secure_url);
            if (!rasterRes.ok) throw new Error(`rasterized fetch failed: ${rasterRes.status}`);
            const rasterBuffer = Buffer.from(await rasterRes.arrayBuffer());
            references.push({ buffer: rasterBuffer, mimeType: 'image/png', label: file.originalname || 'artwork' });
          } else {
            references.push({ buffer: file.buffer, mimeType: file.mimetype, label: file.originalname || 'artwork' });
          }
        } catch (err) {
          // Artwork is an input, not the deliverable — a failed upload shouldn't sink the
          // run. A non-SVG file still reaches the models from the original bytes already in
          // memory; an SVG that failed to rasterize has no safe fallback bytes — sending the
          // raw SVG through is exactly the error being fixed here — so it is dropped rather
          // than reintroduced.
          console.error(`[wrap-mockup] artwork ${i} upload failed: ${err.message}`);
          if (!isSvg) references.push({ buffer: file.buffer, mimeType: file.mimetype, label: file.originalname || 'artwork' });
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

      // 'evolve' respects what they already have; 'reinvent' starts over. Default bold,
      // since a business asking for a mockup usually wants to see something better.
      const mode = designMode === 'evolve' ? 'evolve' : 'reinvent';
      // Orthogonal to designMode: one is how far to depart, the other how loud to be.
      // 'bold' is the dense trade-truck treatment, 'simple' the restrained premium one.
      const intensity = designIntensity === 'simple' ? 'simple' : 'bold';
      // Orthogonal to both: how MUCH of the vehicle is wrapped at all, as opposed to how
      // busy the wrapped area is. Defaults to full so existing callers are unaffected.
      const coverage = ['sides', 'sides_rear', 'spot'].includes(wrapCoverage) ? wrapCoverage : 'full';

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

      // The original request, not just its creative output — needed later to reload this run
      // into the form, and to reconstruct the `business` object a refine call re-briefs from.
      // Artwork files themselves aren't included: they're never persisted as re-uploadable
      // files, only as the Cloudinary URLs already captured in artwork_urls below.
      const requestContext = {
        businessName: businessName.trim(),
        service: service?.trim() || '',
        tagline: tagline?.trim() || '',
        phone: phone || '', website: website || '',
        primaryColor: resolvedColors.primary, accentColor: resolvedColors.accent,
        autoColors: useDetected,
        year, make: make.trim(), model: model.trim(), trim: trim || '',
        customerEmail: customerEmail?.trim() || '',
        serviceArea: wrapContent.serviceArea || '',
        yearsInBusiness: wrapContent.yearsInBusiness || '',
        socialHandle: wrapContent.socialHandle || '',
        services: wrapContent.services,
        badges: wrapContent.badges,
        designMode: mode, designIntensity: intensity, wrapCoverage: coverage,
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
        wrapCoverage: coverage,
        content: wrapContent,
      }, userId, references);

      // 5. One base image — reused for both variants so a fresh vehicle per variant doesn't
      //    give two different vans, which would defeat comparing designs. Its view count
      //    matches coverage: three views for a full wrap, fewer for a partial one — see
      //    renderBaseVehicle.
      const baseImage = await renderBaseVehicle({ year, make, model, trim, coverage });
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
            coverage,
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
            // Kept (not just the assembled image_prompt) so a later refine call can show
            // Claude exactly what it wrote last time and change only what's asked — these
            // never reached the UI or the old stored shape, only image_prompt did.
            designSpec: variant.design_spec,
            sidePrompt: variant.side_prompt,
            frontPrompt: variant.front_prompt || undefined,
            rearPrompt: variant.rear_prompt || undefined,
            imagePrompt: variant.image_prompt,
          });
        } catch (err) {
          console.error(`[wrap-mockup] variant ${variant.id} failed: ${err.message}`);
          failures.push({ id: variant.id, label: variant.label, error: err.message });
        }
      }

      if (variants.length === 0) {
        // The reservation still stands and still counts against today's quota — a Claude
        // brief and up to two Gemini attempts were real spend even though nothing
        // paintable came back. Marked failed rather than left at 'generating' forever, so
        // history shows what happened instead of an eternal spinner.
        await pool.query(
          `UPDATE wrap_mockups SET status = 'failed', creative_summary = $2 WHERE id = $1`,
          [mockupId, brief.creative_summary || null]
        ).catch(() => {});
        return res.status(502).json({
          error: 'Every variant failed to render. Nothing was saved.',
          detail: failures[0]?.error,
        });
      }

      await pool.query(
        `UPDATE wrap_mockups
            SET source_photo_url = $2, variants = $3, creative_summary = $4,
                dominant_message = $5, artwork_urls = $6, brand_colors = $7,
                request_context = $8, status = 'done'
          WHERE id = $1`,
        [mockupId, sourcePhotoUrl, JSON.stringify(variants),
         brief.creative_summary || null,
         [brief.inferred_trade, brief.dominant_message].filter(Boolean).join(' — ') || null,
         JSON.stringify(artworkUploads), JSON.stringify(resolvedColors), JSON.stringify(requestContext)]
      );

      res.json({
        mockupId,
        createdAt,
        vehicle,
        creativeSummary: brief.creative_summary,
        dominantMessage: brief.dominant_message,
        inferredTrade: brief.inferred_trade,
        brandRead: brief.brand_read,
        brandWarning: brief.brand_warning || undefined,
        ctaType: brief.cta_type,
        designMode: mode,
        designIntensity: intensity,
        wrapCoverage: coverage,
        // Echoed back so the UI can show what was actually used after the caps were applied.
        wrapContent,
        sourcePhotoUrl,
        variants,
        // So the UI can show which colours were actually used and pre-fill the pickers.
        brandColors: resolvedColors,
        artwork: artworkUploads,
        // Reported rather than hidden — two concepts were promised, and the UI says
        // so when fewer came back.
        partial: failures.length > 0 ? failures : undefined,
      });
    } catch (error) {
      if (mockupId) {
        await pool.query("UPDATE wrap_mockups SET status = 'failed' WHERE id = $1", [mockupId]).catch(() => {});
      }
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
              artwork_urls, brand_colors, status, request_context
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

// POST /api/tools/wrap-mockup/:id/refine - Tweak one already-rendered variant instead of
// re-rolling the whole run. Re-briefs through Claude first (so the printed-copy fields —
// services, phone, palette swatches — stay in sync with whatever changed), then repaints via
// Gemini from the SAME base image and reference artwork the original run used. The revised
// result is appended to that variant's revision history rather than replacing it outright, so
// a tweak that makes things worse can be stepped back from.
router.post('/wrap-mockup/:id/refine', authenticateToken, requireToolsAccess, async (req, res) => {
  const userId = req.user.userId;
  const mockupId = Number(req.params.id);
  const { variantId, instruction } = req.body || {};

  if (!Number.isInteger(mockupId)) return res.status(400).json({ error: 'Invalid mockup id' });
  if (!variantId?.trim()) return res.status(400).json({ error: 'variantId is required' });
  if (!instruction?.trim()) return res.status(400).json({ error: 'A revision instruction is required' });

  try {
    const row = await pool.query(
      `SELECT id, variants, source_photo_url, artwork_urls, request_context, status
         FROM wrap_mockups WHERE id = $1 AND user_id = $2`,
      [mockupId, userId]
    );
    if (row.rows.length === 0) return res.status(404).json({ error: 'Mockup not found' });
    const mockup = row.rows[0];
    if (mockup.status !== 'done') {
      return res.status(409).json({ error: `This mockup is ${mockup.status}, not ready to refine` });
    }
    if (!mockup.request_context || !mockup.source_photo_url) {
      // Rows created before request_context existed have nothing to refine from.
      return res.status(409).json({ error: 'This mockup predates the refine feature and cannot be refined — generate a new one.' });
    }

    const variants = Array.isArray(mockup.variants) ? mockup.variants : [];
    const variantIndex = variants.findIndex(v => v.id === variantId);
    if (variantIndex === -1) return res.status(404).json({ error: 'Variant not found on this mockup' });
    const variant = variants[variantIndex];

    // Recorded before the paid work starts, same reasoning as wrap_brand_scans: a failed
    // refine still burned a Claude call and a Gemini call, so it still counts.
    const rate = await pool.query(
      `SELECT COUNT(*)::int AS n FROM wrap_mockup_refinements
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    if (rate.rows[0].n >= REFINEMENTS_PER_DAY) {
      return res.status(429).json({
        error: `Daily limit of ${REFINEMENTS_PER_DAY} refinements reached. Try again tomorrow.`,
        code: 'RATE_LIMITED',
      });
    }
    await pool.query(
      'INSERT INTO wrap_mockup_refinements (user_id, mockup_id) VALUES ($1, $2)',
      [userId, mockupId]
    );

    // Re-fetch the bytes this request doesn't have in memory — the original request did,
    // but that request is long finished. Same fetch-and-buffer fetchImage already uses for
    // brand-scan's logo/photo candidates.
    const { buffer: baseImage } = await fetchImage(mockup.source_photo_url, 10 * 1024 * 1024);
    const artworkUrls = Array.isArray(mockup.artwork_urls) ? mockup.artwork_urls : [];
    const references = [];
    for (const art of artworkUrls) {
      try {
        const { buffer, contentType } = await fetchImage(art.url, 5 * 1024 * 1024);
        references.push({ buffer, mimeType: sniffImageType(buffer) || contentType, label: art.name || 'artwork' });
      } catch (err) {
        console.warn(`[wrap-mockup-refine] artwork re-fetch failed: ${err.message}`);
      }
    }

    const ctx = mockup.request_context;
    const business = {
      businessName: ctx.businessName,
      service: ctx.service || undefined,
      tagline: ctx.tagline || undefined,
      phone: ctx.phone, website: ctx.website,
      primaryColor: ctx.primaryColor, accentColor: ctx.accentColor,
      vehicle: [ctx.year, ctx.make, ctx.model, ctx.trim].filter(Boolean).join(' '),
      designMode: ctx.designMode, designIntensity: ctx.designIntensity, wrapCoverage: ctx.wrapCoverage,
      content: {
        services: ctx.services || [], badges: ctx.badges || [],
        serviceArea: ctx.serviceArea || undefined,
        yearsInBusiness: ctx.yearsInBusiness || undefined,
        socialHandle: ctx.socialHandle || undefined,
      },
    };

    const revised = await refineWrapVariant(business, {
      id: variant.id, label: variant.label, color_strategy: variant.color_strategy,
      signature: variant.signature, rationale: variant.rationale, palette: variant.palette,
      wordmark: variant.wordmark, trade_descriptor: variant.tradeDescriptor,
      tagline: variant.tagline || '', services_shown: variant.servicesShown || [],
      credentials_shown: variant.credentialsShown || [],
      phone_display: variant.phoneDisplay || '', website_display: variant.websiteDisplay || '',
      mascot: variant.mascot || '', design_spec: variant.designSpec,
      side_prompt: variant.sidePrompt, front_prompt: variant.frontPrompt || '',
      rear_prompt: variant.rearPrompt || '',
    }, instruction.trim(), userId, references);

    configureCloudinary();
    const uploadBuffer = makeUploader(userId);
    const painted = await paintWrap({
      baseImage,
      imagePrompt: revised.image_prompt,
      references,
      intensity: ctx.designIntensity,
      coverage: ctx.wrapCoverage,
    });
    const revisionNumber = (variant.revisions?.length || 1);
    const uploaded = await uploadBuffer(painted, `${Date.now()}-${variant.id}-refine-${revisionNumber}`);

    const newState = {
      id: variant.id,
      label: revised.label,
      rationale: revised.rationale,
      signature: revised.signature,
      color_strategy: revised.color_strategy,
      palette: revised.palette,
      wordmark: revised.wordmark,
      tradeDescriptor: revised.trade_descriptor,
      tagline: revised.tagline || undefined,
      servicesShown: revised.services_shown,
      credentialsShown: revised.credentials_shown,
      phoneDisplay: revised.phone_display || undefined,
      websiteDisplay: revised.website_display || undefined,
      mascot: revised.mascot || undefined,
      imageUrl: uploaded.secure_url,
      designSpec: revised.design_spec,
      sidePrompt: revised.side_prompt,
      frontPrompt: revised.front_prompt || undefined,
      rearPrompt: revised.rear_prompt || undefined,
      imagePrompt: revised.image_prompt,
      instruction: instruction.trim(),
      changeSummary: revised.change_summary || undefined,
      createdAt: new Date().toISOString(),
    };

    // First refinement on this variant seeds revision 0 with the pre-refine state (labelled
    // "Original") so stepping back has somewhere to go; every later refine just appends.
    const revisions = Array.isArray(variant.revisions) && variant.revisions.length > 0
      ? variant.revisions
      : [{ ...variant, instruction: null, changeSummary: undefined, createdAt: variant.createdAt || null }];
    revisions.push(newState);

    // The variant's top-level fields mirror the LATEST revision, so every other read path
    // (GET /wrap-mockups, the main generate response shape) keeps working unchanged.
    variants[variantIndex] = { ...newState, revisions };

    await pool.query('UPDATE wrap_mockups SET variants = $2 WHERE id = $1', [mockupId, JSON.stringify(variants)]);

    res.json({ mockupId, variant: variants[variantIndex] });
  } catch (error) {
    if (error instanceof WrapImageError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    console.error('[wrap-mockup-refine] failed:', error.message);
    res.status(500).json({ error: 'Failed to refine mockup', detail: error.message });
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

    // A fetch-engine scan can only see plain HTML — no JavaScript ran, so a logo, gallery
    // or lazy-loaded image that a builder platform (Wix, Squarespace, GoDaddy) renders
    // client-side is invisible to it. That degraded read used to be silent; surfaced here
    // as the first "missing" note so the salesperson knows why a scan came back thin
    // rather than assuming the tool just didn't try.
    const missing = site.engine === 'fetch'
      ? ['Read as plain HTML, not a rendered page — a logo or photos built by the page\'s own JavaScript may not have been visible to this scan.', ...(scan.missing || [])]
      : (scan.missing || []);

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
      missing,
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
