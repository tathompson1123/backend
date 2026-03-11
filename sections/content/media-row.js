// ============================================
// MEDIA ROW
// 1–5 images or videos in a responsive horizontal row.
// Column count auto-adjusts to item count.
// Supports image URLs, YouTube, Vimeo, and direct video files.
// ============================================

module.exports = {
  id: 'media-row',
  name: 'Media Row',
  category: 'content',
  description: '1–5 images or videos side by side — layout auto-adjusts to item count',

  suitability: {
    autoDetailing: 0.9, landscaping: 0.9, cleaning: 0.9, hvac: 0.8,
    salonSpa: 0.9, fitness: 0.9, dental: 0.8, restaurant: 0.9,
    realEstate: 0.9, photography: 1.0, legal: 0.7, renovation: 0.95, petGrooming: 0.8,
  },

  contentSchema: {
    title: { type: 'text',  label: 'Section Title (optional)', default: '' },
    items: {
      type: 'array',
      label: 'Images / Videos (1–5)',
      itemSchema: {
        src:     { type: 'text', label: 'Image URL or Video URL (YouTube/Vimeo)', default: '' },
        caption: { type: 'text', label: 'Caption (optional)', default: '' },
      },
    },
  },

  render(content, theme, sectionId = 'media-row') {
    const s = `section-${sectionId}`;
    const rawItems = Array.isArray(content.items) ? content.items : [];
    const items = rawItems.filter(it => (it.src || it.url || '').trim()).slice(0, 5);
    const count = Math.max(1, items.length);

    // ── helpers ──────────────────────────────
    function getEmbedUrl(src) {
      const ytMatch = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/\s]+)/);
      if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0`;
      const vimeoMatch = src.match(/vimeo\.com\/(\d+)/);
      if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
      return null;
    }

    function isVideoSrc(src) {
      if (!src) return false;
      return (
        src.includes('youtube.com') || src.includes('youtu.be') ||
        src.includes('vimeo.com') ||
        /\.(mp4|webm|ogg)(\?.*)?$/i.test(src)
      );
    }

    // ── render each item ─────────────────────
    const itemsHtml = items.map((item, i) => {
      const src = (item.src || item.url || '').trim();
      const caption = (item.caption || '').trim();
      const isVid = isVideoSrc(src);
      const embedUrl = isVid ? getEmbedUrl(src) : null;

      let mediaHtml;
      if (isVid && embedUrl) {
        mediaHtml = `<iframe
          src="${embedUrl}"
          frameborder="0"
          allowfullscreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          class="${s}-frame"
          title="${caption || `Video ${i + 1}`}"></iframe>`;
      } else if (isVid && src) {
        mediaHtml = `<video src="${src}" controls class="${s}-frame" preload="metadata"></video>`;
      } else {
        mediaHtml = `<img src="${src}" alt="${caption}" class="${s}-img" loading="lazy" />`;
      }

      return `
    <figure class="${s}-item">
      <div class="${s}-wrap">${mediaHtml}</div>
      ${caption ? `<figcaption class="${s}-cap">${caption}</figcaption>` : ''}
    </figure>`;
    }).join('\n');

    const emptyHtml = `<p class="${s}-empty">Add up to 5 images or videos in the editor.</p>`;

    return `
<section class="${s}" id="${sectionId}">
  ${content.title ? `
  <div class="${s}-header">
    <h2 class="${s}-title">${content.title}</h2>
  </div>` : ''}
  <div class="${s}-grid">
    ${items.length ? itemsHtml : emptyHtml}
  </div>
</section>

<style>
  .${s} {
    padding: 4rem 2rem;
    background: ${theme.bgColor || '#ffffff'};
  }

  .${s}-header {
    max-width: 1280px;
    margin: 0 auto 2rem;
    text-align: center;
  }

  .${s}-title {
    font-family: '${theme.headingFont || 'Inter'}', sans-serif;
    font-size: clamp(1.6rem, 3vw, 2.25rem);
    font-weight: 700;
    color: ${theme.textColor || '#1f2937'};
    margin: 0;
  }

  .${s}-grid {
    max-width: 1280px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(${count}, 1fr);
    gap: clamp(0.75rem, 1.5vw, 1.25rem);
    align-items: start;
  }

  .${s}-item {
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .${s}-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: ${theme.borderRadius || '12px'};
    background: ${theme.surfaceColor || '#f3f4f6'};
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  }

  .${s}-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.35s ease;
  }

  .${s}-item:hover .${s}-img {
    transform: scale(1.03);
  }

  .${s}-frame {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }

  .${s}-cap {
    font-family: '${theme.bodyFont || 'Inter'}', sans-serif;
    font-size: 0.82rem;
    color: ${theme.textMuted || '#6b7280'};
    text-align: center;
    margin: 0;
    line-height: 1.4;
  }

  .${s}-empty {
    color: ${theme.textMuted || '#6b7280'};
    text-align: center;
    font-style: italic;
    padding: 3rem 0;
  }

  /* Tablet: collapse 4–5 cols to 2 */
  @media (max-width: 900px) {
    .${s}-grid {
      grid-template-columns: repeat(${Math.min(count, 2)}, 1fr);
    }
  }

  /* Mobile: single column */
  @media (max-width: 560px) {
    .${s} {
      padding: 2.5rem 1rem;
    }
    .${s}-grid {
      grid-template-columns: 1fr;
    }
  }
</style>`;
  },
};
