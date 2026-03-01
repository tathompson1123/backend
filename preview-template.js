// Quick preview script — run with: node preview-template.js
const { renderGeminiTemplate } = require('./utils/renderGeminiTemplate');
const { THEMES } = require('./sections/themes');
const fs = require('fs');

const theme = THEMES.cleaning; // cleaning theme

const templateData = {
  html: `<div class="{{S}}-wrapper">
  <div class="{{S}}-hero">
    <div class="{{S}}-hero-content reveal">
      <p class="{{S}}-subtitle">{{subtitle}}</p>
      <h1 class="{{S}}-headline">{{headline}}</h1>
      <p class="{{S}}-desc">{{description}}</p>
      <a href="{{ctaUrl}}" class="{{S}}-cta">{{ctaText}}</a>
    </div>
    <div class="{{S}}-hero-images">
      <img src="{{heroImage1}}" alt="Cleaning" class="{{S}}-img-main reveal" />
      <img src="{{heroImage2}}" alt="Details" class="{{S}}-img-offset reveal" />
    </div>
  </div>

  <div class="{{S}}-services">
    <div class="{{S}}-services-header reveal">
      <h2 class="{{S}}-services-title">{{servicesTitle}}</h2>
    </div>
    <div class="{{S}}-services-list">
      <!-- LOOP_START: items -->
      <div class="{{S}}-service-item reveal">
        <div class="{{S}}-service-img-wrapper">
          <img src="{{item.image}}" alt="{{item.title}}" class="{{S}}-service-img" />
        </div>
        <div class="{{S}}-service-text">
          <h3 class="{{S}}-service-name">{{item.title}}</h3>
          <p class="{{S}}-service-detail">{{item.description}}</p>
          <a href="{{ctaUrl}}" class="{{S}}-service-link">Discover More</a>
        </div>
      </div>
      <!-- LOOP_END: items -->
    </div>
  </div>
</div>`,

  css: `.{{S}}-wrapper {
  font-family: {{theme.bodyFont}}, sans-serif;
  color: {{theme.textColor}};
  background-color: {{theme.bgColor}};
  overflow: hidden;
  padding-bottom: 120px;
}

.{{S}}-hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: 60px;
  padding: 120px 5% 80px;
  max-width: 1400px;
  margin: 0 auto;
}

@media (min-width: 992px) {
  .{{S}}-hero {
    grid-template-columns: 1fr 1fr;
    align-items: center;
    padding: 160px 5% 120px;
  }
}

.{{S}}-hero-content {
  max-width: 500px;
}

.{{S}}-subtitle {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 24px;
  color: {{theme.textColor}};
  opacity: 0.6;
}

.{{S}}-headline {
  font-family: {{theme.headingFont}}, serif;
  font-size: clamp(3rem, 6vw, 5.5rem);
  font-weight: 300;
  line-height: 1.05;
  margin-bottom: 32px;
  color: {{theme.textColor}};
}

.{{S}}-desc {
  font-size: 1.125rem;
  line-height: 1.8;
  margin-bottom: 48px;
  color: {{theme.textColor}};
  opacity: 0.8;
  font-weight: 300;
}

.{{S}}-cta {
  display: inline-block;
  border: 1px solid {{theme.textColor}};
  color: {{theme.textColor}};
  padding: 16px 40px;
  text-decoration: none;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  transition: all 0.4s ease;
  background: transparent;
}

.{{S}}-cta:hover {
  background: {{theme.textColor}};
  color: {{theme.bgColor}};
}

.{{S}}-hero-images {
  position: relative;
  height: 600px;
}

.{{S}}-img-main {
  width: 80%;
  height: 80%;
  object-fit: cover;
  position: absolute;
  top: 0;
  right: 0;
}

.{{S}}-img-offset {
  width: 50%;
  height: 60%;
  object-fit: cover;
  position: absolute;
  bottom: 0;
  left: 0;
  box-shadow: 20px 20px 60px rgba(0,0,0,0.05);
}

.{{S}}-services {
  padding: 80px 5% 0;
  max-width: 1400px;
  margin: 0 auto;
}

.{{S}}-services-header {
  text-align: center;
  margin-bottom: 80px;
}

.{{S}}-services-title {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  color: {{theme.textColor}};
  opacity: 0.6;
}

.{{S}}-services-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 60px;
}

@media (min-width: 768px) {
  .{{S}}-services-list {
    grid-template-columns: 1fr 1fr;
    gap: 40px;
  }
}

.{{S}}-service-item {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.{{S}}-service-img-wrapper {
  width: 100%;
  aspect-ratio: 3/4;
  overflow: hidden;
}

.{{S}}-service-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.8s ease;
}

.{{S}}-service-item:hover .{{S}}-service-img {
  transform: scale(1.05);
}

.{{S}}-service-text {
  text-align: center;
  padding: 0 20px;
}

.{{S}}-service-name {
  font-family: {{theme.headingFont}}, serif;
  font-size: 1.75rem;
  font-weight: 300;
  margin-bottom: 16px;
  color: {{theme.textColor}};
}

.{{S}}-service-detail {
  font-size: 0.95rem;
  line-height: 1.7;
  color: {{theme.textColor}};
  opacity: 0.7;
  margin-bottom: 24px;
}

.{{S}}-service-link {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: {{theme.textColor}};
  text-decoration: none;
  border-bottom: 1px solid rgba(0,0,0,0.2);
  padding-bottom: 4px;
  transition: opacity 0.3s ease;
}

.{{S}}-service-link:hover {
  opacity: 0.6;
}`,

  js: '',
};

const content = {
  headline: 'PURIFY YOUR SPACE',
  subtitle: 'Bespoke House & Carpet Care',
  description: 'We believe a clean home is the foundation of a peaceful mind. Experience meticulous, high-end cleaning tailored to your sanctuary.',
  ctaText: 'Inquire Now',
  ctaUrl: '#contact',
  heroImage1: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&q=80',
  heroImage2: 'https://images.unsplash.com/photo-1527515637-60eab1b86d1a?w=800&q=80',
  servicesTitle: 'OUR SERVICES',
  items: [
    {
      title: 'Signature House Cleaning',
      description: 'A comprehensive, top-to-bottom refresh of your living spaces, using eco-friendly, premium products.',
      image: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&q=80',
    },
    {
      title: 'Deep Carpet Restoration',
      description: 'Advanced steam extraction and stain treatment to breathe new life into your carpets and rugs.',
      image: 'https://images.unsplash.com/photo-1558904541-efa843a96f0f?w=800&q=80',
    },
  ],
};

const sectionHtml = renderGeminiTemplate(templateData, content, theme, 'editorial-cleaning-services');

const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview — Editorial Cleaning Services</title>
  <link href="${theme.fontImport}" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: '${theme.bodyFont}', sans-serif;
      background: ${theme.bgColor};
      color: ${theme.textColor};
      -webkit-font-smoothing: antialiased;
    }
    img { max-width: 100%; height: auto; }
    a { color: inherit; text-decoration: none; }
    .reveal { opacity: 1; transform: none; }
  </style>
</head>
<body>
${sectionHtml}
</body>
</html>`;

fs.writeFileSync('preview.html', page, 'utf8');
console.log('✅ preview.html written');
