// ============================================
// CUSTOM ROW — Flexible row/column layout
// Allows any combination of heading, text,
// image, button, spacer, and divider elements.
// ============================================

module.exports = {
  id: 'custom-row',
  name: 'Custom Row',
  category: 'custom',

  render: (content = {}, theme, sectionId = 'custom') => {
    const s = `section-${sectionId}`;
    const {
      layout = '2col',
      columns = [],
      bgColor = '',
      padding = 'normal',
    } = content;

    const bg = bgColor || theme.bgColor || '#ffffff';

    const paddingMap = {
      none:   '0 2rem',
      small:  '2rem 2rem',
      normal: '4rem 2rem',
      large:  '6rem 2rem',
    };
    const paddingVal = paddingMap[padding] || paddingMap.normal;

    // Column grid-template-columns
    const gridCols = {
      '1col':            '1fr',
      '2col':            '1fr 1fr',
      '2col-wide-left':  '2fr 1fr',
      '2col-wide-right': '1fr 2fr',
      '3col':            '1fr 1fr 1fr',
    };
    const gridTemplate = gridCols[layout] || '1fr 1fr';
    const colCount = (layout === '1col') ? 1 : (layout === '3col') ? 3 : 2;

    // Ensure we have the right number of columns
    const normalizedCols = [];
    for (let i = 0; i < colCount; i++) {
      normalizedCols.push(columns[i] || { elements: [] });
    }

    function renderElement(el, idx) {
      if (!el || !el.type) return '';
      const key = `${s}-el-${idx}`;
      switch (el.type) {
        case 'heading': {
          const tag = el.tag || 'h2';
          const align = el.align || 'left';
          const color = el.color || theme.textColor || '#1f2937';
          return `<${tag} class="${key}" style="text-align:${align};color:${color};">${el.text || 'Heading'}</${tag}>`;
        }
        case 'text': {
          const align = el.align || 'left';
          const color = el.color || theme.textMuted || '#4b5563';
          return `<p class="${key}" style="text-align:${align};color:${color};">${el.text || ''}</p>`;
        }
        case 'image': {
          const rounded = el.rounded !== false;
          const shadow  = el.shadow !== false;
          const radius  = rounded ? (theme.borderRadius || '12px') : '0';
          const boxShadow = shadow ? '0 4px 24px rgba(0,0,0,0.12)' : 'none';
          return `<img class="${key}" src="${el.url || ''}" alt="${el.alt || ''}" style="width:100%;height:auto;border-radius:${radius};box-shadow:${boxShadow};display:block;" />`;
        }
        case 'button': {
          const align = el.align || 'left';
          const style = el.style || 'primary';
          const size  = el.size  || 'medium';
          const sizePad = size === 'small' ? '0.6rem 1.4rem' : size === 'large' ? '1.2rem 3rem' : '0.85rem 2.2rem';
          const fontSize = size === 'small' ? '0.875rem' : size === 'large' ? '1.125rem' : '1rem';
          let btnStyle = '';
          if (style === 'primary') {
            btnStyle = `background:${theme.primaryColor || '#6366f1'};color:#fff;border:2px solid transparent;`;
          } else if (style === 'secondary') {
            btnStyle = `background:${theme.accentColor || '#10b981'};color:#fff;border:2px solid transparent;`;
          } else {
            // outline
            btnStyle = `background:transparent;color:${theme.primaryColor || '#6366f1'};border:2px solid ${theme.primaryColor || '#6366f1'};`;
          }
          return `<div class="${key}-wrap" style="text-align:${align};">
  <a href="${el.link || '#'}" class="${key}" style="${btnStyle}padding:${sizePad};font-size:${fontSize};font-family:'${theme.headingFont}',sans-serif;font-weight:600;text-decoration:none;display:inline-block;border-radius:${theme.buttonRadius || '8px'};transition:transform 0.2s,box-shadow 0.2s;">${el.text || 'Button'}</a>
</div>`;
        }
        case 'spacer': {
          const h = el.height || 32;
          return `<div class="${key}" style="height:${h}px;"></div>`;
        }
        case 'divider': {
          const color = el.color || theme.borderColor || '#e5e7eb';
          const margin = el.margin || 16;
          return `<hr class="${key}" style="border:none;border-top:1px solid ${color};margin:${margin}px 0;" />`;
        }
        default:
          return '';
      }
    }

    function renderColumn(col, colIdx) {
      const elements = (col.elements || []).map((el, elIdx) => renderElement(el, `${colIdx}-${elIdx}`)).join('\n  ');
      return `<div class="${s}-col">${elements ? '\n  ' + elements + '\n' : ''}</div>`;
    }

    const columnsHtml = normalizedCols.map((col, i) => renderColumn(col, i)).join('\n');

    return `
<section class="${s}" id="${s}">
  <div class="${s}-container">
    <div class="${s}-grid">
${columnsHtml}
    </div>
  </div>
</section>
<style>
  .${s} {
    padding: ${paddingVal};
    background: ${bg};
  }
  .${s}-container {
    max-width: 1200px;
    margin: 0 auto;
  }
  .${s}-grid {
    display: grid;
    grid-template-columns: ${gridTemplate};
    gap: 2.5rem;
    align-items: start;
  }
  .${s}-col {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .${s}-col h1, .${s}-col h2, .${s}-col h3, .${s}-col h4 {
    font-family: '${theme.headingFont}', sans-serif;
    font-weight: 700;
    line-height: 1.2;
    margin: 0;
  }
  .${s}-col h1 { font-size: clamp(2rem,   4vw, 3rem); }
  .${s}-col h2 { font-size: clamp(1.6rem, 3vw, 2.25rem); }
  .${s}-col h3 { font-size: clamp(1.25rem,2vw, 1.75rem); }
  .${s}-col h4 { font-size: clamp(1rem,   1.5vw, 1.375rem); }
  .${s}-col p {
    font-family: '${theme.bodyFont}', sans-serif;
    font-size: 1.0625rem;
    line-height: 1.8;
    margin: 0;
  }
  @media (max-width: 768px) {
    .${s}-grid {
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }
  }
</style>
`;
  }
};
