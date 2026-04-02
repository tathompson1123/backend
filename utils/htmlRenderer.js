// ============================================
// RENDER PAGE SCHEMA TO HTML (Backend Version)
// Converts JSON schema to static HTML for publishing
// ============================================

function renderPageToHtml(pageData, options = {}) {
  const { includeDoctype = true, includeHead = true, userId = null } = options;

  if (!pageData || !pageData.sections) {
    return '<html><body><p>No content</p></body></html>';
  }

  const sectionsHtml = pageData.sections
    .map((section) => renderSection(section))
    .join('\n');

  if (!includeHead) {
    return sectionsHtml;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageData.title || 'Untitled Page')}</title>
  <meta name="description" content="${escapeHtml(pageData.description || '')}">
  ${userId ? `<meta name="user-id" content="${userId}">` : ''}
  ${userId ? `<script>window.__SORCE_USER_ID__='${userId}';window.__SORCE_APP_URL__='${process.env.VITE_APP_URL || 'https://www.sorceintegrations.com'}';window.__SORCE_API_URL__='${process.env.VITE_API_URL || process.env.BACKEND_URL || 'https://backend-production-ab50.up.railway.app'}';</script>` : ''}
  ${pageData.settings?.favicon ? `<link rel="icon" href="${pageData.settings.favicon}">` : ''}
  ${pageData.settings?.ogImage ? `<meta property="og:image" content="${pageData.settings.ogImage}">` : ''}
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${getBaseStyles()}
  </style>
</head>
<body>
  ${sectionsHtml}
</body>
</html>`;

  return html;
}

// ============================================
// RENDER SECTION
// ============================================
function renderSection(section) {
  const bgStyle = getBackgroundStyle(section.background);
  const sectionStyle = {
    ...bgStyle,
    paddingTop: section.style?.paddingTop || '60px',
    paddingBottom: section.style?.paddingBottom || '60px',
    paddingLeft: section.style?.paddingLeft || '20px',
    paddingRight: section.style?.paddingRight || '20px',
    position: 'relative',
  };

  const styleAttr = objectToStyleString(sectionStyle);
  const rowsHtml = section.rows?.map((row) => renderRow(row)).join('\n') || '';

  // Overlay div if needed
  const overlayHtml = section.background?.overlay
    ? `<div style="position: absolute; inset: 0; background-color: ${section.background.overlay};"></div>`
    : '';

  return `
<section class="section section-${section.type || 'content'}" style="${styleAttr}">
  ${overlayHtml}
  <div style="position: relative; z-index: 1;">
    ${rowsHtml}
  </div>
</section>`;
}

// ============================================
// RENDER ROW
// ============================================
function renderRow(row) {
  const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: row.style?.gap || '24px',
    maxWidth: row.style?.maxWidth || '1200px',
    margin: row.style?.margin || '0 auto',
    padding: row.style?.padding || '20px 0',
  };

  const columnsHtml = row.columns?.map((col) => renderColumn(col, row.columns.length)).join('\n') || '';

  return `
<div class="row" style="${objectToStyleString(rowStyle)}">
  ${columnsHtml}
</div>`;
}

// ============================================
// RENDER COLUMN
// ============================================
function renderColumn(column, totalColumns) {
  const colStyle = {
    width: column.width || `${100 / totalColumns}%`,
    minWidth: '0',
    padding: column.style?.padding || '0',
    display: 'flex',
    flexDirection: 'column',
  };

  const widgetsHtml = column.widgets?.map((w) => renderWidget(w)).join('\n') || '';

  return `
<div class="column" style="${objectToStyleString(colStyle)}">
  ${widgetsHtml}
</div>`;
}

// ============================================
// RENDER WIDGET
// ============================================
function renderWidget(widget) {
  switch (widget.type) {
    case 'text':
      return renderTextWidget(widget);
    case 'image':
      return renderImageWidget(widget);
    case 'video':
      return renderVideoWidget(widget);
    case 'button':
      return renderButtonWidget(widget);
    case 'button-group':
      return renderButtonGroupWidget(widget);
    case 'spacer':
      return renderSpacerWidget(widget);
    case 'divider':
      return renderDividerWidget(widget);
    case 'form':
      return renderFormWidget(widget);
    case 'testimonial':
      return renderTestimonialWidget(widget);
    case 'icon':
      return renderIconWidget(widget);
    case 'html':
      return widget.content?.code || '';
    default:
      return `<!-- Unknown widget type: ${widget.type} -->`;
  }
}

// ============================================
// WIDGET RENDERERS
// ============================================

function renderTextWidget(widget) {
  const content = widget.content || {};
  const style = widget.style || {};
  const tag = content.tag || 'p';

  const textStyle = {
    fontSize: style.fontSize || '16px',
    fontWeight: style.fontWeight || 'normal',
    color: style.color || '#1f2937',
    lineHeight: style.lineHeight || '1.6',
    textAlign: content.alignment || 'left',
    marginBottom: style.marginBottom || '16px',
    maxWidth: style.maxWidth || 'none',
    margin: style.margin || undefined,
  };

  return `<${tag} style="${objectToStyleString(textStyle)}">${escapeHtml(content.text || '')}</${tag}>`;
}

function renderImageWidget(widget) {
  const content = widget.content || {};
  const style = widget.style || {};

  if (!content.src) return '';

  const imgStyle = {
    width: content.width || '100%',
    maxWidth: '100%',
    height: 'auto',
    borderRadius: style.borderRadius || '8px',
    display: 'block',
  };

  const img = `<img src="${content.src}" alt="${escapeHtml(content.alt || '')}" style="${objectToStyleString(imgStyle)}" loading="lazy">`;

  if (content.link) {
    return `<a href="${content.link}">${img}</a>`;
  }

  return img;
}

function renderVideoWidget(widget) {
  const content = widget.content || {};

  if (!content.src) return '';

  // YouTube/Vimeo embed
  const ytMatch = content.src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (ytMatch) {
    return `
<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px;">
  <iframe src="https://www.youtube.com/embed/${ytMatch[1]}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>`;
  }

  const vimeoMatch = content.src.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return `
<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px;">
  <iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
</div>`;
  }

  // Direct video
  return `<video src="${content.src}" ${content.controls !== false ? 'controls' : ''} ${content.autoplay ? 'autoplay muted' : ''} ${content.loop ? 'loop' : ''} style="width: 100%; display: block; border-radius: 8px;"></video>`;
}

function renderButtonWidget(widget) {
  const content = widget.content || {};
  const style = widget.style || {};

  const btnStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: style.padding || '14px 28px',
    fontSize: style.fontSize || '16px',
    fontWeight: style.fontWeight || '600',
    borderRadius: style.borderRadius || '8px',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    border: content.style === 'outline' ? `2px solid ${style.borderColor || style.backgroundColor || '#8b5cf6'}` : 'none',
    backgroundColor: content.style === 'outline' ? 'transparent' : (style.backgroundColor || '#8b5cf6'),
    color: style.color || (content.style === 'outline' ? '#8b5cf6' : '#ffffff'),
  };

  return `
<div style="text-align: ${content.alignment || 'center'};">
  <a href="${content.link || '#'}" style="${objectToStyleString(btnStyle)}">${escapeHtml(content.text || 'Click Here')}</a>
</div>`;
}

function renderButtonGroupWidget(widget) {
  const content = widget.content || {};
  const buttons = content.buttons || [];

  const containerStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: content.gap || '16px',
    justifyContent: content.alignment || 'center',
  };

  const buttonsHtml = buttons.map((btn) => {
    const btnStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '14px 28px',
      fontSize: '16px',
      fontWeight: '600',
      borderRadius: '8px',
      textDecoration: 'none',
      transition: 'all 0.2s ease',
      border: btn.style === 'outline' ? '2px solid currentColor' : 'none',
      backgroundColor: btn.style === 'outline' ? 'transparent' : (btn.style === 'secondary' ? '#1f2937' : '#8b5cf6'),
      color: btn.style === 'outline' ? '#8b5cf6' : '#ffffff',
    };

    return `<a href="${btn.link || '#'}" style="${objectToStyleString(btnStyle)}">${escapeHtml(btn.text)}</a>`;
  }).join('\n');

  return `
<div style="${objectToStyleString(containerStyle)}">
  ${buttonsHtml}
</div>`;
}

function renderSpacerWidget(widget) {
  const content = widget.content || {};
  return `<div style="height: ${content.height || '40px'};"></div>`;
}

function renderDividerWidget(widget) {
  const content = widget.content || {};
  const hrStyle = {
    width: content.width || '100%',
    borderStyle: content.style || 'solid',
    borderColor: content.color || '#e5e7eb',
    borderWidth: `${content.thickness || '1px'} 0 0 0`,
    margin: '24px auto',
  };

  return `<hr style="${objectToStyleString(hrStyle)}">`;
}

function renderFormWidget(widget) {
  const content = widget.content || {};
  const fields = content.fields || [
    { id: 'name', type: 'text', label: 'Name', required: true },
    { id: 'email', type: 'email', label: 'Email', required: true },
    { id: 'phone', type: 'tel', label: 'Phone', required: true },
    { id: 'message', type: 'textarea', label: 'Message', required: false },
  ];

  const fieldsHtml = fields.map((field) => {
    const label = `<label style="display: block; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 6px;">${escapeHtml(field.label)}${field.required ? '<span style="color: #ef4444; margin-left: 4px;">*</span>' : ''}</label>`;

    let input;
    if (field.type === 'textarea') {
      input = `<textarea name="${field.id || field.label.toLowerCase()}" rows="4" style="width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; transition: border-color 0.2s;" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}></textarea>`;
    } else {
      input = `<input type="${field.type || 'text'}" name="${field.id || field.label.toLowerCase()}" style="width: 100%; padding: 12px 16px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 16px; transition: border-color 0.2s;" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>`;
    }

    return `<div style="margin-bottom: 20px;">${label}${input}</div>`;
  }).join('\n');

  // SMS Consent checkbox
  const smsConsentHtml = `
<div style="display: flex; align-items: start; gap: 12px; margin-bottom: 24px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
  <input type="checkbox" id="sms-consent" name="sms_consent" required style="width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0; cursor: pointer;">
  <label for="sms-consent" style="font-size: 14px; line-height: 1.5; color: #4b5563; cursor: pointer;">
    I consent to receive text messages from ${escapeHtml(content.businessName || 'our team')} about services I&apos;m interested in. Message &amp; data rates may apply. Message frequency may vary. Reply STOP to unsubscribe.
  </label>
</div>`;

  return `
<form id="contact-form" style="padding: 32px; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
  ${fieldsHtml}
  ${smsConsentHtml}
  <button type="submit" style="width: 100%; padding: 16px; background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); color: #ffffff; font-size: 18px; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;">
    ${escapeHtml(content.submitText || 'Send Message')}
  </button>
  <div id="form-status" style="display: none; margin-top: 16px; padding: 16px; border-radius: 8px; text-align: center; font-weight: 600;"></div>
</form>
<script>
document.getElementById('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  const statusEl = document.getElementById('form-status');
  
  const smsConsent = formData.get('sms_consent') === 'on';
  if (!smsConsent) {
    statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
    statusEl.style.display = 'block';
    statusEl.style.background = '#fef3c7';
    statusEl.style.color = '#92400e';
    return;
  }
  
  const originalText = button.textContent;
  button.textContent = 'Sending...';
  button.disabled = true;
  
  try {
    const userId = document.querySelector('meta[name="user-id"]')?.content;
    if (!userId) throw new Error('Configuration error');
    
    const apiUrl = 'https://backend-production-ab50.up.railway.app';
    const response = await fetch(apiUrl + '/api/leads/public/' + userId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.get('name') || '',
        email: formData.get('email') || '',
        phone: formData.get('phone') || '',
        service: formData.get('service') || '',
        message: formData.get('message') || '',
        sms_consent: true,
        source: 'website_form'
      })
    });
    
    if (response.ok) {
      statusEl.textContent = '✅ Thanks! We\\'ll be in touch soon.';
      statusEl.style.display = 'block';
      statusEl.style.background = '#d1fae5';
      statusEl.style.color = '#065f46';
      form.reset();
    } else {
      throw new Error('Failed');
    }
  } catch (error) {
    statusEl.textContent = '❌ Something went wrong. Please call us directly.';
    statusEl.style.display = 'block';
    statusEl.style.background = '#fee2e2';
    statusEl.style.color = '#991b1b';
  } finally {
    button.textContent = originalText;
    button.disabled = false;
  }
});
</script>`;
}

function renderTestimonialWidget(widget) {
  const content = widget.content || {};

  const starsHtml = content.rating
    ? `<div style="font-size: 20px; margin-bottom: 16px; color: #fbbf24;">${'★'.repeat(content.rating)}${'☆'.repeat(5 - content.rating)}</div>`
    : '';

  const avatarHtml = content.avatar
    ? `<img src="${content.avatar}" alt="${escapeHtml(content.author)}" style="width: 56px; height: 56px; border-radius: 50%; object-fit: cover;">`
    : `<div style="width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6, #6366f1); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 20px;">${(content.author || 'A')[0].toUpperCase()}</div>`;

  return `
<div style="background: #ffffff; padding: 32px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); height: 100%;">
  ${starsHtml}
  <blockquote style="color: #374151; font-size: 18px; font-style: italic; margin-bottom: 24px; line-height: 1.6;">
    "${escapeHtml(content.quote || '')}"
  </blockquote>
  <div style="display: flex; align-items: center; gap: 16px;">
    ${avatarHtml}
    <div>
      <p style="font-weight: 700; color: #111827; margin: 0; font-size: 16px;">${escapeHtml(content.author || 'Customer')}</p>
      ${content.role ? `<p style="font-size: 14px; color: #6b7280; margin: 4px 0 0 0;">${escapeHtml(content.role)}</p>` : ''}
    </div>
  </div>
</div>`;
}

function renderIconWidget(widget) {
  const content = widget.content || {};
  
  // Simple emoji-based icons
  const icons = {
    star: '⭐', heart: '❤️', check: '✅', arrow: '➡️', phone: '📞',
    email: '📧', location: '📍', clock: '🕐', calendar: '📅', user: '👤',
    settings: '⚙️', home: '🏠', search: '🔍', cart: '🛒', dollar: '💰',
    shield: '🛡️', lightning: '⚡', trophy: '🏆', thumbsup: '👍', fire: '🔥',
    car: '🚗', wrench: '🔧', sparkles: '✨', leaf: '🌿', water: '💧',
  };

  return `
<div style="text-align: center;">
  <span style="font-size: ${content.size || '48px'}; line-height: 1; display: inline-block;">
    ${icons[content.icon] || '⭐'}
  </span>
</div>`;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getBackgroundStyle(bg) {
  if (!bg) return {};

  switch (bg.type) {
    case 'color':
      return { backgroundColor: bg.value };
    case 'gradient':
      return { background: bg.value };
    case 'image':
      return {
        backgroundImage: `url(${bg.value})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    default:
      return {};
  }
}

function objectToStyleString(styleObj) {
  return Object.entries(styleObj)
    .filter(([_, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${cssKey}: ${value}`;
    })
    .join('; ');
}

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function getBaseStyles() {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      color: #1f2937;
      -webkit-font-smoothing: antialiased;
    }
    img { max-width: 100%; height: auto; }
    a { color: inherit; text-decoration: none; }
    a:hover { opacity: 0.9; }
    
    /* Mobile responsive */
    @media (max-width: 768px) {
      .row { flex-direction: column !important; }
      .column { width: 100% !important; min-width: 100% !important; }
      h1 { font-size: 32px !important; }
      h2 { font-size: 28px !important; }
      section { padding-left: 16px !important; padding-right: 16px !important; }
    }
    
    /* Form focus states */
    input:focus, textarea:focus {
      outline: none;
      border-color: #8b5cf6 !important;
    }
    
    /* Button hover */
    button:hover, a[style*="background"]:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
  `;
}

module.exports = { renderPageToHtml };
