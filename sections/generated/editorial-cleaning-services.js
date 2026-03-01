// AUTO-GENERATED from preview-template.js (Gemini editorial cleaning template)
// Editorial split hero + services grid for cleaning businesses

const { renderGeminiTemplate } = require('../../utils/renderGeminiTemplate');

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
  color: {{theme.primaryColor}};
  font-weight: 600;
}

.{{S}}-headline {
  font-family: {{theme.headingFont}}, sans-serif;
  font-size: clamp(2.5rem, 5vw, 4.5rem);
  font-weight: 700;
  line-height: 1.1;
  margin-bottom: 32px;
  color: {{theme.textColor}};
}

.{{S}}-desc {
  font-size: 1.125rem;
  line-height: 1.8;
  margin-bottom: 48px;
  color: {{theme.textMuted}};
  font-weight: 400;
}

.{{S}}-cta {
  display: inline-block;
  background: {{theme.primaryColor}};
  color: #ffffff;
  padding: 16px 40px;
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  border-radius: {{theme.buttonRadius}};
  transition: all 0.3s ease;
  box-shadow: 0 4px 20px {{theme.primaryColor}}40;
}

.{{S}}-cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px {{theme.primaryColor}}60;
}

.{{S}}-hero-images {
  position: relative;
  height: 560px;
}

.{{S}}-img-main {
  width: 78%;
  height: 78%;
  object-fit: cover;
  position: absolute;
  top: 0;
  right: 0;
  border-radius: {{theme.borderRadius}};
}

.{{S}}-img-offset {
  width: 50%;
  height: 55%;
  object-fit: cover;
  position: absolute;
  bottom: 0;
  left: 0;
  border-radius: {{theme.borderRadius}};
  box-shadow: 20px 20px 60px rgba(0,0,0,0.08);
  border: 4px solid {{theme.bgColor}};
}

.{{S}}-services {
  padding: 80px 5% 0;
  max-width: 1400px;
  margin: 0 auto;
}

.{{S}}-services-header {
  text-align: center;
  margin-bottom: 64px;
}

.{{S}}-services-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  color: {{theme.primaryColor}};
  font-weight: 700;
}

.{{S}}-services-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 60px;
}

@media (min-width: 768px) {
  .{{S}}-services-list {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 40px;
  }
}

.{{S}}-service-item {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.{{S}}-service-img-wrapper {
  width: 100%;
  aspect-ratio: 3/4;
  overflow: hidden;
  border-radius: {{theme.borderRadius}};
}

.{{S}}-service-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.8s ease;
}

.{{S}}-service-item:hover .{{S}}-service-img {
  transform: scale(1.04);
}

.{{S}}-service-text {
  text-align: center;
  padding: 0 12px;
}

.{{S}}-service-name {
  font-family: {{theme.headingFont}}, sans-serif;
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 12px;
  color: {{theme.textColor}};
}

.{{S}}-service-detail {
  font-size: 0.95rem;
  line-height: 1.7;
  color: {{theme.textMuted}};
  margin-bottom: 20px;
}

.{{S}}-service-link {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: {{theme.primaryColor}};
  text-decoration: none;
  border-bottom: 2px solid {{theme.primaryColor}};
  padding-bottom: 3px;
  transition: opacity 0.3s ease;
  font-weight: 600;
}

.{{S}}-service-link:hover {
  opacity: 0.7;
}`,

  js: '',
};

module.exports = {
  id:       'editorial-cleaning-services',
  name:     'Editorial Cleaning — Hero + Services',
  category: 'hero',
  mood:     ['clean', 'professional', 'editorial'],
  suitability: { cleaning: 0.98, dental: 0.6, salonSpa: 0.5 },
  contentSchema: {
    headline:      { type: 'text',     label: 'Headline',            default: 'PURIFY YOUR SPACE' },
    subtitle:      { type: 'text',     label: 'Tag / Subtitle',      default: 'Bespoke House & Carpet Care' },
    description:   { type: 'textarea', label: 'Description',         default: 'We believe a clean home is the foundation of a peaceful mind. Experience meticulous, high-end cleaning tailored to your sanctuary.' },
    ctaText:       { type: 'text',     label: 'Button Text',         default: 'Inquire Now' },
    ctaUrl:        { type: 'url',      label: 'Button Link',         default: '#contact' },
    heroImage1:    { type: 'image',    label: 'Main Hero Image',     default: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&q=80' },
    heroImage2:    { type: 'image',    label: 'Offset Hero Image',   default: 'https://images.unsplash.com/photo-1527515637-60eab1b86d1a?w=800&q=80' },
    servicesTitle: { type: 'text',     label: 'Services Label',      default: 'OUR SERVICES' },
    items: {
      type: 'array',
      label: 'Services',
      itemSchema: {
        title:       { type: 'text',     label: 'Service Name' },
        description: { type: 'textarea', label: 'Description' },
        image:       { type: 'image',    label: 'Service Image' },
      },
    },
  },

  render(content, theme, sectionId) {
    return renderGeminiTemplate(templateData, content, theme, sectionId);
  },
};
