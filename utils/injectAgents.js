// ============================================
// AGENT INJECTION HELPER
// Checks whether the user has a deployed chat agent
// and injects the widget into rendered HTML automatically.
// Call this after every renderPage() so agents survive
// regeneration and editor saves.
// ============================================

const { generateChatWidgetCode } = require('./chatWidget');
const { generateBookingWidgetCode } = require('./bookingWidget');

// Safe string insertion before </body> — avoids String.replace() special
// patterns ($', $`, $&, etc.) that corrupt widget code containing '$'.
function insertBeforeBody(html, code) {
  const idx = html.lastIndexOf('</body>');
  if (idx === -1) return html;
  return html.slice(0, idx) + code + '\n' + html.slice(idx);
}

/**
 * Injects the chat widget into HTML if the user has one deployed.
 * @param {string} html       - The rendered page HTML
 * @param {string} userId    - The business owner's user ID
 * @param {object} pool       - pg connection pool
 * @param {object} theme      - The page theme object (has primaryColor, etc.)
 * @returns {Promise<string>} - HTML with widget injected (or unchanged)
 */
async function injectAgents(html, userId, pool, theme) {
  if (!html || !userId || !pool) return html;

  try {
    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    const cfg = result.rows[0]?.config;
    // Widget is live only when explicitly deployed. Backward-compat: treat enabled=true
    // with no 'deployed' field as deployed (existing agents before this flag existed).
    const isLive = cfg?.deployed === true || (cfg?.enabled === true && !('deployed' in (cfg || {})));
    if (result.rows.length > 0 && isLive) {
      const config = cfg;
      const websiteColors = {
        primaryColor: theme?.primaryColor || '#667eea',
        accentColor: theme?.accentColor || '#764ba2',
        textColor: theme?.textColor || '#1f2937'
      };

      const widgetCode = generateChatWidgetCode(userId, config, websiteColors);

      // Replace existing widget if present, otherwise inject fresh
      const widgetRegex = /<!-- SORCE Chat Agent -->[\s\S]*?<!-- End SORCE Chat Agent -->/;
      if (html.includes('sorce-chat-widget')) {
        html = html.replace(widgetRegex, widgetCode.trim());
        console.log('🔄 injectAgents: chat widget replaced with latest version');
      } else {
        html = insertBeforeBody(html, widgetCode);
        console.log('✅ injectAgents: chat widget injected');
      }
    }
  } catch (err) {
    // Non-fatal: website still renders, widget just won't be present
    console.error('⚠️ injectAgents: could not check chat agent config:', err.message);
  }

  // Always inject booking widget (uses public endpoints, no config needed)
  try {
    const bookingWidget = generateBookingWidgetCode(userId, theme || {});
    const bookingRegex = /<!-- SORCE Booking Widget -->[\s\S]*?<\/script>\s*/;
    if (html.includes('sorce-booking-overlay')) {
      html = html.replace(bookingRegex, bookingWidget.trim());
      console.log('🔄 injectAgents: booking widget replaced');
    } else {
      html = insertBeforeBody(html, bookingWidget);
      console.log('✅ injectAgents: booking widget injected');
    }
  } catch (err) {
    console.error('⚠️ injectAgents: booking widget injection failed:', err.message);
  }

  return html;
}

module.exports = { injectAgents };
