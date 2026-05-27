/* Splits liquid-ppf-v2.html into self-contained per-section snippets for Wix embeds. */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const outDir = path.join(dir, 'ppf-sections');
fs.mkdirSync(outDir, { recursive: true });

const src = fs.readFileSync(path.join(dir, 'liquid-ppf-v2.html'), 'utf8');

const css = (src.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const body = (src.match(/<body>([\s\S]*?)<script>/) || [, ''])[1];

const fonts =
`  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />`;

// Universal JS: nav toggle + reveal-on-scroll + before/after slider (each no-ops if absent)
const js =
`  <script>
    var t=document.querySelector('.menu-toggle'),l=document.getElementById('navLinks');
    if(t&&l){t.addEventListener('click',function(){l.classList.toggle('open');});}
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in-view');io.unobserve(e.target);}});},{threshold:0.15,rootMargin:'0px 0px -60px 0px'});
    document.querySelectorAll('.reveal,.reveal-stagger').forEach(function(el){io.observe(el);});
    var ba=document.getElementById('baSlider');
    if(ba){var r=ba.querySelector('.ba-range');var sp=function(v){ba.style.setProperty('--pos',v+'%');};r.addEventListener('input',function(){sp(r.value);});sp(r.value);}
  </script>`;

// Ordered comment markers -> output file. Topbar block absorbs the Nav (next comment) up to hero.
const markers = [
  { c: '<!-- Hero -->',                                    slug: '01-hero',         title: 'Hero' },
  { c: '<!-- What is NANOPRO (KEPT) -->',                  slug: '02-what-it-is',   title: 'What It Is' },
  { c: '<!-- Protection visual: hydrophobic beading -->',  slug: '03-hydrophobic',  title: 'Hydrophobic' },
  { c: '<!-- Before & Afters: slider + gallery -->',       slug: '04-before-after', title: 'Before & After' },
  { c: '<!-- Thickness (SIMPLIFIED) -->',                  slug: '05-thickness',    title: 'Thickness' },
  { c: '<!-- Comparison (KEPT) -->',                       slug: '06-comparison',   title: 'NANOPRO vs PPF' },
  { c: '<!-- Assurance band (KEPT) -->',                   slug: '07-our-promise',  title: 'Our Promise' },
  { c: '<!-- Benefits strip (SCANNABLE) -->',              slug: '08-benefits',     title: 'Benefits' },
  { c: '<!-- Process (KEPT) -->',                          slug: '09-process',      title: 'How We Apply' },
  { c: '<!-- Pricing (KEPT) -->',                          slug: '10-packages',     title: 'Packages' },
  { c: '<!-- FAQ (KEPT) -->',                              slug: '11-faq',          title: 'FAQ' },
  { c: '<!-- CTA band (refreshed) -->',                    slug: '12-cta',          title: 'CTA' },
];

const positions = markers.map(m => {
  const idx = body.indexOf(m.c);
  if (idx === -1) throw new Error('Marker not found: ' + m.c);
  return idx;
});

const written = [];
for (let i = 0; i < markers.length; i++) {
  const start = positions[i];
  const end = (i + 1 < markers.length) ? positions[i + 1] : body.length;
  const block = body.slice(start, end).trim();

  const html =
`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${markers[i].title} — NANOPRO Liquid PPF</title>
${fonts}
  <style>
${css}
  </style>
</head>
<body>

${block}

${js}
</body>
</html>
`;
  const file = markers[i].slug + '.html';
  fs.writeFileSync(path.join(outDir, file), html, 'utf8');
  written.push(file + '  (' + html.length + ' bytes)');
}

console.log('Wrote ' + written.length + ' snippets to ppf-sections/:');
written.forEach(w => console.log('  ' + w));
