// ============================================
// CONTENT BLOCK - Flexible content section
// Supports heading, text, image, and button
// ============================================

module.exports = {
  id: 'content-block',
  name: 'Content Block',
  category: 'content',

  render: (content = {}, theme, sectionId) => {
    const s = sectionId;
    const {
      heading = '',
      text = '',
      imageUrl = '',
      imageAlt = '',
      buttonText = '',
      buttonLink = '',
      align = 'left'
    } = content;

    const alignClass = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    const textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';

    return `
<section class="${s}" id="${s}">
  <div class="${s}-container">
    ${heading ? `<h2 class="${s}-heading">${heading}</h2>` : ''}
    ${text ? `<p class="${s}-text">${text}</p>` : ''}
    ${imageUrl ? `<img src="${imageUrl}" alt="${imageAlt || ''}" class="${s}-image" />` : ''}
    ${buttonText && buttonLink ? `<a href="${buttonLink}" class="${s}-button">${buttonText}</a>` : ''}
  </div>
</section>
<style>
  .${s} {
    padding: 4rem 2rem;
    background: ${theme.bgColor || '#ffffff'};
  }
  .${s}-container {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: ${alignClass};
    gap: 1.5rem;
  }
  .${s}-heading {
    font-family: '${theme.headingFont}', sans-serif;
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: ${theme.textColor || '#1f2937'};
    margin: 0;
    text-align: ${textAlign};
  }
  .${s}-text {
    font-family: '${theme.bodyFont}', sans-serif;
    font-size: 1.125rem;
    line-height: 1.8;
    color: ${theme.textMuted || 'rgba(0,0,0,0.7)'};
    margin: 0;
    text-align: ${textAlign};
    white-space: pre-wrap;
  }
  .${s}-image {
    max-width: 100%;
    height: auto;
    border-radius: ${theme.borderRadius || '12px'};
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
  }
  .${s}-button {
    display: inline-block;
    padding: 1rem 2.5rem;
    background: ${theme.primaryColor || '#6366f1'};
    color: #ffffff;
    font-family: '${theme.headingFont}', sans-serif;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    border-radius: ${theme.buttonRadius || '8px'};
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .${s}-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px ${theme.primaryColor}40;
  }
  @media (max-width: 768px) {
    .${s} {
      padding: 3rem 1.5rem;
    }
    .${s}-heading {
      font-size: 1.75rem;
    }
    .${s}-text {
      font-size: 1rem;
    }
  }
</style>
`;
  }
};
