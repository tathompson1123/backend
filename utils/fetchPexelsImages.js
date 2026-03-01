// ============================================
// PEXELS IMAGE FETCHER
// Pre-fetches verified, high-quality images per business type
// so Claude never has to invent Unsplash photo IDs.
// Returns { hero: [url, url], cards: [url x8] }
// Falls back to [] on any error so generation still works.
// ============================================

const https = require('https');

// Search queries per layout/business type — ordered by best relevance first
const QUERIES = {
  autoDetailing: [
    'luxury car detailing professional',
    'car wash detailing shiny',
    'auto detailing ceramic coating',
  ],
  cleaning: [
    'professional house cleaning service',
    'cleaning crew bright home',
    'maid service sparkling clean',
  ],
  renovation: [
    'modern kitchen renovation remodel',
    'home renovation contractor professional',
    'bathroom remodel luxury',
  ],
  photography: [
    'professional photography studio portrait',
    'wedding photographer couple',
    'photographer camera professional shoot',
  ],
  organic: [
    'landscaping garden professional green',
    'lawn care landscaping outdoor',
    'garden design beautiful landscape',
  ],
  plumbing: [
    'plumber professional pipe repair',
    'plumbing service work',
  ],
  hvac: [
    'hvac technician air conditioning system',
    'heating cooling service professional',
  ],
  electrical: [
    'electrician professional wiring panel',
    'electrical service work',
  ],
  roofing: [
    'roofing contractor professional installation',
    'roof shingles repair',
  ],
  painting: [
    'painter professional interior house',
    'house painting exterior brush',
  ],
  salon: [
    'hair salon stylist professional',
    'barber shop haircut styling',
  ],
  spa: [
    'spa massage relaxing professional',
    'wellness spa treatment',
  ],
  fitness: [
    'personal trainer gym professional',
    'fitness workout coach',
  ],
  catering: [
    'catering food professional event',
    'chef cooking restaurant professional',
  ],
  default: [
    'professional service business team',
    'business professional office',
  ],
};

// Map detectLayout() values + raw business types to query keys
function getQueryKey(businessType, layout) {
  if (layout && QUERIES[layout]) return layout;
  const bt = (businessType || '').toLowerCase();
  if (bt.includes('plumb')) return 'plumbing';
  if (bt.includes('hvac') || bt.includes('heat') || bt.includes('cool') || bt.includes('air')) return 'hvac';
  if (bt.includes('electric')) return 'electrical';
  if (bt.includes('roof')) return 'roofing';
  if (bt.includes('paint')) return 'painting';
  if (bt.includes('salon') || bt.includes('barber') || bt.includes('hair')) return 'salon';
  if (bt.includes('spa') || bt.includes('massage')) return 'spa';
  if (bt.includes('fit') || bt.includes('gym') || bt.includes('train')) return 'fitness';
  if (bt.includes('cater') || bt.includes('chef') || bt.includes('food')) return 'catering';
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

    // Merge, dedupe by ID
    const seen = new Set();
    const photos = [];
    for (const p of [...(photos1 || []), ...(photos2 || [])]) {
      if (!seen.has(p.id)) { seen.add(p.id); photos.push(p); }
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
