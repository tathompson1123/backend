// ============================================
// PEXELS IMAGE FETCHER
// Pre-fetches verified, high-quality images per business type
// so Claude never has to invent Unsplash photo IDs.
// Returns { hero: [url, url], cards: [url x8] }
// Falls back to [] on any error so generation still works.
// ============================================

const https = require('https');

// Search queries per layout/business type — ordered by best relevance first
// Specific subcategories appear before broad fallbacks so precise matches win.
const QUERIES = {
  // ── Auto ───────────────────────────────────────────
  autoDetailing: [
    'luxury car detailing professional',
    'ceramic coating car shine',
    'auto detailing polishing vehicle',
  ],
  autoRepair: [
    'auto mechanic repair shop professional',
    'car engine repair garage',
    'automotive service technician',
  ],
  autoWrap: [
    'car vinyl wrap professional',
    'vehicle wrap color change',
    'auto wrap installation studio',
  ],
  // ── Cleaning subcategories ─────────────────────────
  carpetCleaning: [
    'clean carpet fibers close up',
    'carpet steam cleaning machine',
    'freshly cleaned carpet living room',
  ],
  windowCleaning: [
    'window cleaning professional squeegee',
    'clean sparkling windows exterior',
    'window washer high rise building',
  ],
  pressureWashing: [
    'pressure washing driveway concrete',
    'power washing house siding professional',
    'pressure washer cleaning surface',
  ],
  upholsteryCleaning: [
    'upholstery cleaning sofa professional',
    'furniture steam cleaning couch',
    'upholstery cleaner fabric restoration',
  ],
  commercialCleaning: [
    'commercial office cleaning professional',
    'janitorial service office building',
    'commercial cleaner mopping floor',
  ],
  houseCleaning: [
    'maid service cleaning bright home interior',
    'professional house cleaner kitchen',
    'clean modern home interior bright',
  ],
  cleaning: [
    'professional cleaning service bright home',
    'cleaning technician sparkling interior',
    'clean modern bright home interior',
  ],
  // ── Trades ────────────────────────────────────────
  plumbing: [
    'plumber pipe fitting professional',
    'plumbing repair under sink',
    'plumber technician water heater',
  ],
  hvac: [
    'hvac technician air conditioning unit',
    'heating cooling system installation',
    'hvac service technician ductwork',
  ],
  electrical: [
    'electrician wiring electrical panel',
    'electrical service installation professional',
    'electrician working conduit',
  ],
  roofing: [
    'roofing shingles installation contractor',
    'roof repair professional contractor',
    'new roof installation aerial',
  ],
  painting: [
    'house painting interior professional roller',
    'exterior house painting contractor brush',
    'painter spray wall professional',
  ],
  // ── Landscaping ────────────────────────────────────
  organic: [
    'landscaping garden design lush green',
    'lawn care mowing professional',
    'landscape garden beautiful outdoor',
  ],
  lawnCare: [
    'lawn mowing professional neat grass',
    'lawn care service green yard',
    'grass cutting landscaping neat',
  ],
  // ── Home services ─────────────────────────────────
  renovation: [
    'kitchen remodel modern renovation',
    'bathroom renovation luxury remodel',
    'home renovation contractor professional',
  ],
  handyman: [
    'handyman repair home professional',
    'home repair maintenance service',
    'contractor tools home improvement',
  ],
  // ── Beauty / Wellness ──────────────────────────────
  salon: [
    'hair salon stylist cutting professional',
    'barber haircut modern shop',
    'hair styling salon interior',
  ],
  spa: [
    'spa massage therapy relaxing',
    'wellness spa treatment professional',
    'massage table spa luxury',
  ],
  fitness: [
    'personal trainer coaching gym',
    'fitness training workout professional',
    'gym workout weights training',
  ],
  petGrooming: [
    'dog grooming professional bath',
    'pet groomer grooming salon',
    'dog wash grooming cute',
  ],
  // ── Food ──────────────────────────────────────────
  catering: [
    'catering food elegant event spread',
    'chef cooking professional kitchen',
    'catering service plated food event',
  ],
  // ── Photography ───────────────────────────────────
  photography: [
    'professional photographer camera studio',
    'wedding photography couple outdoor',
    'portrait photography studio lighting',
  ],
  // ── Default ───────────────────────────────────────
  default: [
    'professional service business team',
    'business professional working office',
  ],
};

// Ordered specificity map: check more specific substrings first
const KEYWORD_MAP = [
  // Cleaning subcategories — must come before generic 'cleaning'
  ['carpet clean',        'carpetCleaning'],
  ['window clean',        'windowCleaning'],
  ['pressure wash',       'pressureWashing'],
  ['power wash',          'pressureWashing'],
  ['upholstery',          'upholsteryCleaning'],
  ['commercial clean',    'commercialCleaning'],
  ['janitorial',          'commercialCleaning'],
  ['office clean',        'commercialCleaning'],
  ['maid',                'houseCleaning'],
  ['house clean',         'houseCleaning'],
  ['home clean',          'houseCleaning'],
  ['clean',               'cleaning'],
  // Auto subcategories
  ['wrap',                'autoWrap'],
  ['ceramic coat',        'autoDetailing'],
  ['detail',              'autoDetailing'],
  ['auto repair',         'autoRepair'],
  ['mechanic',            'autoRepair'],
  ['car repair',          'autoRepair'],
  // Trades
  ['plumb',               'plumbing'],
  ['hvac',                'hvac'],
  ['heat',                'hvac'],
  ['cool',                'hvac'],
  ['air condition',       'hvac'],
  ['electric',            'electrical'],
  ['roof',                'roofing'],
  ['paint',               'painting'],
  // Landscaping
  ['lawn',                'lawnCare'],
  ['landscap',            'organic'],
  ['garden',              'organic'],
  ['tree',                'organic'],
  // Home services
  ['renovation',          'renovation'],
  ['remodel',             'renovation'],
  ['kitchen remodel',     'renovation'],
  ['bathroom remodel',    'renovation'],
  ['handyman',            'handyman'],
  ['contractor',          'renovation'],
  // Beauty / wellness
  ['salon',               'salon'],
  ['barber',              'salon'],
  ['hair',                'salon'],
  ['spa',                 'spa'],
  ['massage',             'spa'],
  ['gym',                 'fitness'],
  ['fitness',             'fitness'],
  ['train',               'fitness'],
  ['pet',                 'petGrooming'],
  ['groom',               'petGrooming'],
  ['dog',                 'petGrooming'],
  // Food
  ['cater',               'catering'],
  ['chef',                'catering'],
  ['food',                'catering'],
  // Photography
  ['photo',               'photography'],
  ['videograph',          'photography'],
];

// Map detectLayout() values + raw business types to query keys
function getQueryKey(businessType, layout) {
  // Layout-based shortcut (organic, autoDetailing, cleaning, renovation, photography)
  if (layout && QUERIES[layout]) return layout;
  const bt = (businessType || '').toLowerCase();
  // Walk keyword map in order — first match wins
  for (const [kw, key] of KEYWORD_MAP) {
    if (bt.includes(kw)) return key;
  }
  return 'default';
}

function fetchFromPexels(query, count) {
  return new Promise((resolve) => {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ PEXELS_API_KEY not set — skipping image pre-fetch');
      return resolve(null);
    }

    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`;

    const req = https.get(url, { headers: { Authorization: apiKey } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.photos || []);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
  });
}

/**
 * Fetch verified Pexels images for a given business type.
 * @param {string} businessType  - raw businessType from the form
 * @param {string} layout        - layout key from detectLayout()
 * @returns {{ hero: string[], cards: string[] }}
 */
async function fetchPexelsImages(businessType, layout) {
  const key = getQueryKey(businessType, layout);
  const queries = QUERIES[key] || QUERIES.default;
  // Pick a random query from the list for variety
  const query = queries[Math.floor(Math.random() * queries.length)];

  // Also pick a second query for variety if available
  const query2 = queries.length > 1 ? queries[(queries.indexOf(query) + 1) % queries.length] : null;

  console.log(`🖼️ Fetching Pexels images: "${query}"${query2 ? ` + "${query2}"` : ''}`);

  try {
    // Fetch two batches in parallel for more variety (20+ total)
    const [photos1, photos2] = await Promise.all([
      fetchFromPexels(query, 12),
      query2 ? fetchFromPexels(query2, 10) : Promise.resolve([]),
    ]);

    // Merge, dedupe by ID, filter out black & white photos
    const seen = new Set();
    const photos = [];
    for (const p of [...(photos1 || []), ...(photos2 || [])]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      // Skip grayscale/B&W images: avg_color with R≈G≈B within 15 is likely monochrome
      if (p.avg_color) {
        const hex = p.avg_color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        if (Math.max(r, g, b) - Math.min(r, g, b) < 15) continue;
      }
      photos.push(p);
    }

    if (photos.length === 0) return { hero: [], cards: [] };

    // Hero = first 3 photos at high resolution (hero[1] used as cleaning side image)
    const hero = photos.slice(0, 3).map(p =>
      p.src.large2x || p.src.large
    );

    // Cards/gallery = next images at medium resolution (up to 12)
    const cards = photos.slice(3, 15).map(p =>
      p.src.large || p.src.medium
    );

    console.log(`✅ Pexels: got ${hero.length} hero + ${cards.length} card images (${photos.length} total)`);
    return { hero, cards };
  } catch (err) {
    console.warn('⚠️ Pexels fetch failed (using Unsplash fallback):', err.message);
    return { hero: [], cards: [] };
  }
}

module.exports = { fetchPexelsImages };
