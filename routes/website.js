const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../config/middleware');
const { buildVisualSupremacyPrompt } = require('../utils/visual-supremacy-prompt');
const { deployToVercel, addDomainToVercel, checkDomainVerification, removeDomainFromVercel } = require('../services/vercel');
const { searchDomains, purchaseDomain } = require('../services/domain');
const axios = require('axios');

console.log('✅ Website routes module loaded');

router.use((req, res, next) => {
  console.log('🌐 Website route hit:', req.method, req.path);
  next();
});

// Helper functions
function sanitizeForPrompt(str) {
  if (!str) return '';
  return String(str)
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/\$/g, '')
    .replace(/`/g, "'")
    .trim()
    .substring(0, 5000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Add this helper function at the top, after const router = express.Router();
function makeMobileResponsive(html) {
  // Add mobile menu CSS and JS
  const mobileMenuStyles = `
    <style>
      /* Mobile Menu Styles */
      @media (max-width: 768px) {
        /* Hide desktop nav */
        nav > ul, nav > div > ul, header > nav > ul, header nav ul {
          display: none !important;
        }
        
        /* Show mobile menu button */
        .mobile-menu-btn {
          display: flex !important;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          background: transparent;
          border: 2px solid currentColor;
          border-radius: 6px;
          cursor: pointer;
          padding: 0;
          position: relative;
          z-index: 1001;
        }
        
        .mobile-menu-btn span {
          display: block;
          width: 22px;
          height: 2px;
          background: currentColor;
          position: relative;
          transition: all 0.3s;
        }
        
        .mobile-menu-btn span::before,
        .mobile-menu-btn span::after {
          content: '';
          position: absolute;
          width: 22px;
          height: 2px;
          background: currentColor;
          transition: all 0.3s;
        }
        
        .mobile-menu-btn span::before {
          top: -7px;
        }
        
        .mobile-menu-btn span::after {
          bottom: -7px;
        }
        
        .mobile-menu-btn.active span {
          background: transparent;
        }
        
        .mobile-menu-btn.active span::before {
          top: 0;
          transform: rotate(45deg);
        }
        
        .mobile-menu-btn.active span::after {
          bottom: 0;
          transform: rotate(-45deg);
        }
        
        /* Mobile menu panel */
        .mobile-menu-panel {
          display: none;
          position: fixed;
          top: 0;
          right: 0;
          width: 80%;
          max-width: 300px;
          height: 100vh;
          background: white;
          box-shadow: -4px 0 12px rgba(0,0,0,0.15);
          z-index: 1000;
          padding: 80px 20px 20px;
          overflow-y: auto;
        }
        
        .mobile-menu-panel.active {
          display: block;
          animation: slideIn 0.3s ease-out;
        }
        
        @keyframes slideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        
        .mobile-menu-panel a {
          display: block;
          padding: 15px 10px;
          color: inherit;
          text-decoration: none;
          border-bottom: 1px solid #e5e7eb;
          font-size: 16px;
          font-weight: 500;
        }
        
        .mobile-menu-overlay {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100vh;
          background: rgba(0,0,0,0.5);
          z-index: 999;
        }
        
        .mobile-menu-overlay.active {
          display: block;
        }
      }
      
      /* Desktop: hide mobile menu */
      @media (min-width: 769px) {
        .mobile-menu-btn,
        .mobile-menu-panel,
        .mobile-menu-overlay {
          display: none !important;
        }
      }
    </style>
  `;

  const mobileMenuScript = `
    <script>
      (function() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initMobileMenu);
        } else {
          initMobileMenu();
        }
        
        function initMobileMenu() {
          // Find navigation
          const nav = document.querySelector('nav') || document.querySelector('header nav');
          if (!nav) return;
          
          // Get all nav links
          const navLinks = Array.from(nav.querySelectorAll('a'));
          if (navLinks.length === 0) return;
          
          // Create mobile menu button
          const menuBtn = document.createElement('button');
          menuBtn.className = 'mobile-menu-btn';
          menuBtn.innerHTML = '<span></span>';
          menuBtn.setAttribute('aria-label', 'Toggle menu');
          
          // Create mobile menu panel
          const menuPanel = document.createElement('div');
          menuPanel.className = 'mobile-menu-panel';
          
          // Clone nav links into panel
          navLinks.forEach(link => {
            const clonedLink = link.cloneNode(true);
            menuPanel.appendChild(clonedLink);
          });
          
          // Create overlay
          const overlay = document.createElement('div');
          overlay.className = 'mobile-menu-overlay';
          
          // Insert elements
          nav.appendChild(menuBtn);
          document.body.appendChild(overlay);
          document.body.appendChild(menuPanel);
          
          // Toggle function
          function toggleMenu() {
            menuBtn.classList.toggle('active');
            menuPanel.classList.toggle('active');
            overlay.classList.toggle('active');
            document.body.style.overflow = menuPanel.classList.contains('active') ? 'hidden' : '';
          }
          
          // Event listeners
          menuBtn.addEventListener('click', toggleMenu);
          overlay.addEventListener('click', toggleMenu);
          
          // Close on link click
          menuPanel.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', toggleMenu);
          });
        }
      })();
    </script>
  `;

  // Insert before </head>
  if (html.includes('</head>')) {
    html = html.replace('</head>', mobileMenuStyles + '</head>');
  }
  
  // Insert before </body>
  if (html.includes('</body>')) {
    html = html.replace('</body>', mobileMenuScript + '</body>');
  }
  
  return html;
}

function generateChatWidgetCode(userId, agentConfig, websiteColors) {
  const agentName = agentConfig?.agentName || 'Kurt';
  const greetingMessage = agentConfig?.greetingMessage || "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?";
  const autoOpenDelay = agentConfig?.autoOpenDelay || 14;
  const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : process.env.API_URL || 'https://backend-production-ab50.up.railway.app';

  // Use website colors or defaults
  const primaryColor = websiteColors?.primaryColor || '#667eea';
  const accentColor = websiteColors?.accentColor || '#764ba2';
  const textColor = websiteColors?.textColor || '#1f2937';

  return `
<!-- SORCE Chat Agent -->
<div id="sorce-chat-widget"></div>
<style>
#sorce-chat-widget {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
}
.chat-bubble {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  transition: transform 0.2s;
}
.chat-bubble:hover {
  transform: scale(1.1);
}
.chat-bubble svg {
  width: 28px;
  height: 28px;
  color: white;
}
.chat-window {
  position: fixed;
  bottom: 90px;
  right: 20px;
  width: 380px;
  height: 600px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: scale(0);
  transform-origin: bottom right;
  transition: transform 0.3s ease;
}
.chat-window.open {
  transform: scale(1);
}
.chat-header {
  background: linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%);
  color: white;
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.chat-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.chat-close {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 24px;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f9fafb;
}
.chat-message {
  margin-bottom: 16px;
  display: flex;
  gap: 12px;
}
.chat-message.agent .message-bubble {
  background: white;
  color: ${textColor};
  border: 1px solid #e5e7eb;
}
.chat-message.user .message-bubble {
  background: linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%);
  color: white;
  margin-left: auto;
}
.message-bubble {
  max-width: 75%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
}
.chat-input-area {
  padding: 16px;
  border-top: 1px solid #e5e7eb;
  background: white;
}
.chat-input {
  width: 100%;
  padding: 12px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  resize: none;
}
.chat-input:focus {
  outline: none;
  border-color: ${primaryColor};
}
.chat-send-btn {
  margin-top: 8px;
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.chat-send-btn:hover {
  opacity: 0.9;
}
.chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
}
.typing-dot {
  width: 8px;
  height: 8px;
  background: #9ca3af;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-10px); }
}
@media (max-width: 480px) {
  .chat-window {
    width: calc(100vw - 40px);
    height: calc(100vh - 120px);
    right: 20px;
    bottom: 90px;
  }
}
</style>
<script>
(function() {
  console.log('🤖 SORCE Chat Widget - Initializing...');
  console.log('User ID:', '${userId}');
  console.log('API URL:', '${apiUrl}');
  console.log('Agent Name:', '${agentName.replace(/'/g, "\\'")}');
  console.log('Auto-open delay:', ${autoOpenDelay}, 'seconds');
  
  const userId = '${userId}';
  const apiUrl = '${apiUrl}';
  const agentName = '${agentName.replace(/'/g, "\\'")}';
  const greetingMessage = '${greetingMessage.replace(/'/g, "\\'")}';
  const autoOpenDelay = ${autoOpenDelay};
  
  let conversationId = null;
  let isOpen = false;
  
  function createChatWidget() {
    console.log('🔧 Creating chat widget DOM elements...');
    const widget = document.getElementById('sorce-chat-widget');
    
    if (!widget) {
      console.error('❌ Could not find #sorce-chat-widget element!');
      return;
    }
    
    console.log('✅ Found widget container');
    
    widget.innerHTML = '<div class="chat-bubble" onclick="toggleChat()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg></div><div class="chat-window" id="chat-window"><div class="chat-header"><h3>Chat with ' + agentName + '</h3><button class="chat-close" onclick="toggleChat()">×</button></div><div class="chat-messages" id="chat-messages"></div><div class="chat-input-area"><textarea class="chat-input" id="chat-input" placeholder="Type your message..." rows="2" onkeypress="handleKeyPress(event)"></textarea><button class="chat-send-btn" onclick="sendMessage()">Send Message</button></div></div>';
    
    console.log('✅ Chat widget HTML injected');
    
    console.log('⏱️ Will auto-open in ' + autoOpenDelay + ' seconds...');
    setTimeout(function() {
      const hasOpened = sessionStorage.getItem('chat-opened');
      console.log('Auto-open check - Has opened before?', hasOpened);
      
      if (!isOpen && !hasOpened) {
        console.log('🚀 Auto-opening chat widget...');
        toggleChat();
        addMessage(greetingMessage, 'agent');
        sessionStorage.setItem('chat-opened', 'true');
      } else {
        console.log('ℹ️ Skipping auto-open (already opened before)');
      }
    }, autoOpenDelay * 1000);
  }
  
  window.toggleChat = function() {
    isOpen = !isOpen;
    console.log('💬 Toggle chat - New state:', isOpen ? 'OPEN' : 'CLOSED');
    
    const chatWindow = document.getElementById('chat-window');
    if (!chatWindow) {
      console.error('❌ Could not find chat-window element!');
      return;
    }
    
    chatWindow.classList.toggle('open');
    
    if (isOpen && !conversationId) {
      console.log('🆕 Starting new conversation...');
      startConversation();
    }
  };
  
  window.handleKeyPress = function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };
  
  async function startConversation() {
    console.log('📞 API Call: Starting conversation');
    console.log('Endpoint:', apiUrl + '/api/chat/start');
    
    try {
      const response = await fetch(apiUrl + '/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, source: 'website' })
      });
      
      console.log('Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        conversationId = data.conversationId;
        console.log('✅ Conversation started! ID:', conversationId);
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to start conversation:', errorText);
      }
    } catch (error) {
      console.error('❌ Error starting conversation:', error);
    }
  }
  
  window.sendMessage = async function() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message) {
      console.log('⚠️ Empty message, not sending');
      return;
    }
    
    console.log('📤 Sending message:', message);
    
    addMessage(message, 'user');
    input.value = '';
    
    showTypingIndicator();
    
    console.log('📞 API Call: Sending message');
    console.log('Endpoint:', apiUrl + '/api/chat/message');
    console.log('Conversation ID:', conversationId);
    
    try {
      const response = await fetch(apiUrl + '/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          conversationId: conversationId,
          message: message
        })
      });
      
      console.log('Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Received reply:', data.reply);
        hideTypingIndicator();
        addMessage(data.reply, 'agent');
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to send message:', errorText);
        throw new Error('Submission failed');
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      hideTypingIndicator();
      addMessage('Sorry, I had trouble connecting. Please try again.', 'agent');
    }
  };
  
  function addMessage(text, type) {
    console.log('💬 Adding ' + type + ' message:', text);
    const messagesDiv = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message ' + type;
    messageEl.innerHTML = '<div class="message-bubble">' + escapeHtml(text) + '</div>';
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  function showTypingIndicator() {
    console.log('⌛ Showing typing indicator...');
    const messagesDiv = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'chat-message agent';
    indicator.innerHTML = '<div class="message-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>';
    messagesDiv.appendChild(indicator);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  function hideTypingIndicator() {
    console.log('✅ Hiding typing indicator');
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  console.log('📄 Document ready state:', document.readyState);
  if (document.readyState === 'loading') {
    console.log('⏳ Waiting for DOM to load...');
    document.addEventListener('DOMContentLoaded', function() {
      console.log('✅ DOM loaded, creating widget');
      createChatWidget();
    });
  } else {
    console.log('✅ DOM already loaded, creating widget immediately');
    createChatWidget();
  }
  
  console.log('🎉 SORCE Chat Widget script loaded successfully');
})();
</script>
<!-- End SORCE Chat Agent -->
`;
}

// GET - Get website version history
router.get('/versions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      `SELECT id, html_content, pages, created_at, version_number, description
       FROM website_versions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );
    
    res.json({ versions: result.rows });
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

// POST - Mark website as unpublished (has pending changes)
router.post('/mark-unpublished', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    await pool.query(
      'UPDATE websites SET is_published = false WHERE user_id = $1',
      [userId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking unpublished:', error);
    res.status(500).json({ error: 'Failed to mark unpublished' });
  }
});

// POST - Restore a specific version
router.post('/restore-version/:versionId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { versionId } = req.params;
    
    // Get the version
    const versionResult = await pool.query(
      'SELECT html_content, pages FROM website_versions WHERE id = $1 AND user_id = $2',
      [versionId, userId]
    );
    
    if (versionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }
    
    const version = versionResult.rows[0];
    
    // Update current website
    await pool.query(
      `UPDATE websites 
       SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $3`,
      [version.html_content, version.pages, userId]
    );
    
    res.json({ 
      success: true, 
      message: 'Version restored successfully',
      html_content: version.html_content,
      pages: version.pages
    });
  } catch (error) {
    console.error('Error restoring version:', error);
    res.status(500).json({ error: 'Failed to restore version' });
  }
});

router.get('/my-ip', async (req, res) => {
  try {
    const axios = require('axios');
    const ipResponse = await axios.get('https://api.ipify.org?format=json');
    res.json({ 
      railwayIp: ipResponse.data.ip,
      message: 'Add this IP to Porkbun: https://porkbun.com/account/api'
    });
  } catch (error) {
    res.json({ error: 'Could not get IP' });
  }
});

// GET - Fetch user's website
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT * FROM websites WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        success: true,
        website: null 
      });
    }

    const website = result.rows[0];
    if (website.pages && typeof website.pages === 'string') {
      website.pages = JSON.parse(website.pages);
    }

    res.json({ 
      success: true,
      website: website
    });
  } catch (error) {
    console.error('Error fetching website:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch website' 
    });
  }
});

// POST - Save website
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { htmlContent, pages } = req.body;

    if (!htmlContent) {
      return res.status(400).json({ error: 'htmlContent required' });
    }

    const existing = await pool.query(
      'SELECT id FROM websites WHERE user_id = $1',
      [userId]
    );

    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE websites 
         SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3
         RETURNING *`,
        [htmlContent, pages ? JSON.stringify(pages) : null, userId]
      );
    } else {
      result = await pool.query(
        `INSERT INTO websites (user_id, html_content, pages, is_published, created_at, updated_at)
         VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [userId, htmlContent, pages ? JSON.stringify(pages) : null]
      );
    }

    res.json({ 
      success: true,
      website: result.rows[0] 
    });
  } catch (error) {
    console.error('Error saving website:', error);
    res.status(500).json({ error: 'Failed to save website' });
  }
});

router.post('/save', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let { html_content, pages } = req.body;
    
    // Make HTML mobile responsive
    html_content = makeMobileResponsive(html_content);
    
    if (pages) {
      Object.keys(pages).forEach(pageName => {
        pages[pageName] = makeMobileResponsive(pages[pageName]);
      });
    }
    
    // Get current version number
    const versionResult = await pool.query(
      'SELECT COALESCE(MAX(version_number), 0) as max_version FROM website_versions WHERE user_id = $1',
      [userId]
    );
    
    const nextVersion = versionResult.rows[0].max_version + 1;
    
    // Save current state as a version BEFORE updating
    const currentWebsite = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );
    
    if (currentWebsite.rows.length > 0) {
      await pool.query(
        `INSERT INTO website_versions (user_id, html_content, pages, version_number, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId, 
          currentWebsite.rows[0].html_content, 
          currentWebsite.rows[0].pages,
          nextVersion,
          `Saved ${new Date().toLocaleString()}`
        ]
      );
    }
    
    // Update current website
    await pool.query(
      `UPDATE websites 
       SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $3`,
      [html_content, pages, userId]
    );
    
    res.json({ success: true, message: 'Changes saved', version: nextVersion });
  } catch (error) {
    console.error('Error saving website:', error);
    res.status(500).json({ error: 'Failed to save website' });
  }
});

router.post('/publish', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let { html_content, pages } = req.body;
    
    // Make HTML mobile responsive before publishing
    html_content = makeMobileResponsive(html_content);
    
    if (pages) {
      Object.keys(pages).forEach(pageName => {
        pages[pageName] = makeMobileResponsive(pages[pageName]);
      });
    }
    // Save to database first
    await pool.query(
      'UPDATE websites SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
      [html_content, pages, userId]
    );

    // Deploy to Vercel
    const vercelToken = process.env.VERCEL_TOKEN;
    
    if (!vercelToken) {
      throw new Error('Vercel token not configured');
    }

    // Prepare files for deployment
    const files = [];
    const addedFiles = new Set();

    // Add all pages from the pages object
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        if (!addedFiles.has(pageKey)) {
          files.push({
            file: pageKey,
            data: Buffer.from(pages[pageKey]).toString('base64')
          });
          addedFiles.add(pageKey);
          console.log(`📄 Added ${pageKey} to deployment`);
        }
      });
    }

    // Only add index.html from html_content if it wasn't already added from pages
    if (html_content && !addedFiles.has('index.html')) {
      files.push({
        file: 'index.html',
        data: Buffer.from(html_content).toString('base64')
      });
      addedFiles.add('index.html');
      console.log(`📄 Added index.html to deployment`);
    }

    console.log(`📦 Total files to deploy: ${files.length}`);

    if (files.length === 0) {
      throw new Error('No files to deploy');
    }

    // Create deployment
    const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `website-${userId}`,
        files: files,
        projectSettings: {
          framework: null
        }
      })
    });

    if (!deployResponse.ok) {
      const errorText = await deployResponse.text();
      console.error('Vercel deployment error:', errorText);
      throw new Error('Deployment failed: ' + errorText);
    }

    const deployData = await deployResponse.json();
    const deploymentUrl = `https://${deployData.url}`;

    // Update database with new deployment info
    await pool.query(
      'UPDATE websites SET vercel_url = $1, vercel_deployment_id = $2, is_published = true WHERE user_id = $3',
      [deploymentUrl, deployData.id, userId]
    );

    console.log(`✅ Published for user ${userId}: ${deploymentUrl}`);
    
    res.json({ 
      success: true, 
      url: deploymentUrl,
      message: 'Website published successfully'
    });

  } catch (error) {
    console.error('Error publishing website:', error);
    res.status(500).json({ error: 'Failed to publish website', details: error.message });
  }
});

router.get('/check-contact-form', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.json({ isValid: false, issues: ['No website found'] });
    }

    const website = websiteResult.rows[0];
    const htmlContent = website.html_content || '';
    const pages = website.pages || {};

    // Combine all HTML to check
    const allHtml = htmlContent + Object.values(pages).join('');

    const issues = [];
    let isValid = true;

    // Check for ANY contact form - much more flexible patterns
    const hasContactForm = 
      /id=["']contact/i.test(allHtml) ||
      /id=["'].*form["']/i.test(allHtml) ||
      /class=["'].*contact.*form["']/i.test(allHtml) ||
      /<form[^>]*>/i.test(allHtml);  // ANY form element
    
    if (!hasContactForm) {
      issues.push('No contact form found');
      isValid = false;
    }

    // Check for SMS consent checkbox - look for multiple patterns
    const hasSmsConsent = 
      /name=["']sms_consent["']/i.test(allHtml) ||
      /sms.{0,20}consent/i.test(allHtml) ||
      /receive.{0,30}text.{0,30}message/i.test(allHtml) ||
      /agree.{0,50}SMS/i.test(allHtml);
    
    if (!hasSmsConsent) {
      issues.push('No SMS consent checkbox found');
      isValid = false;
    }

    // Check for form submission handler
    const hasFormHandler = 
      /addEventListener.*submit/i.test(allHtml) ||
      /\.submit/i.test(allHtml) ||
      /onsubmit/i.test(allHtml);
    
    if (!hasFormHandler) {
      issues.push('No form submission handler found');
      isValid = false;
    }

    // Check if form posts to correct endpoint
    const hasCorrectEndpoint = /\/api\/leads\/public\//i.test(allHtml);
    if (!hasCorrectEndpoint) {
      issues.push('Form not configured to submit to lead endpoint');
      isValid = false;
    }

    console.log('Contact form check:', { 
      isValid, 
      issues, 
      hasContactForm, 
      hasSmsConsent, 
      hasFormHandler, 
      hasCorrectEndpoint 
    });

    res.json({ isValid, issues });

  } catch (error) {
    console.error('Error checking contact form:', error);
    res.status(500).json({ error: 'Failed to check contact form' });
  }
});

router.get('/check-chat-widget', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.json({ 
        hasWebsite: false,
        hasWidget: false,
        message: 'No website found'
      });
    }

    const website = websiteResult.rows[0];
    let pages = website.pages || {};

    const widgetMarker = 'sorce-chat-widget';
    let pagesWithWidget = [];
    let pagesWithoutWidget = [];

    // Check all pages
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        const html = pages[pageKey];
        if (html && html.includes(widgetMarker)) {
          pagesWithWidget.push(pageKey);
        } else {
          pagesWithoutWidget.push(pageKey);
        }
      });
    }

    // Check main html_content
    if (website.html_content) {
      if (website.html_content.includes(widgetMarker)) {
        pagesWithWidget.push('index.html (main)');
      } else {
        pagesWithoutWidget.push('index.html (main)');
      }
    }

    res.json({
      hasWebsite: true,
      hasWidget: pagesWithWidget.length > 0,
      pagesWithWidget,
      pagesWithoutWidget,
      totalPages: pagesWithWidget.length + pagesWithoutWidget.length
    });

  } catch (error) {
    console.error('Error checking chat widget:', error);
    res.status(500).json({ error: 'Failed to check chat widget' });
  }
});

// ============================================
// POST - Fix/Update Contact Form in Existing Website
// ============================================
router.post('/fix-contact-form', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get website with pages AND colors
    const websiteResult = await pool.query(
      'SELECT html_content, pages, vercel_url, vercel_deployment_id, primary_color, accent_color, text_color FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.status(404).json({ error: 'No website found' });
    }

    const website = websiteResult.rows[0];
    
    // Get colors with defaults
    const primaryColor = website.primary_color || '#667eea';
    const accentColor = website.accent_color || '#764ba2';
    const textColor = website.text_color || '#1f2937';
    
    let pages = website.pages || {};

    // Get REAL API URL
    const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
      : process.env.API_URL || 'https://backend-production-ab50.up.railway.app';

    console.log('🔧 Using API URL:', apiUrl);

    // Helper function to check if page has a contact form
function hasContactForm(html) {
  // Look for ANY form element
  return /<form[^>]*>/i.test(html);
}

function fixContactFormHTML(html, pageName) {
  if (!hasContactForm(html)) return html;

  console.log(`🔧 Fixing contact form in ${pageName}`);

  // Ensure meta tag exists
  if (!html.includes('meta name="user-id"')) {
    html = html.replace('</head>', `  <meta name="user-id" content="${userId}">\n</head>`);
  } else {
    html = html.replace(/<meta name="user-id" content="[^"]*"/, `<meta name="user-id" content="${userId}"`);
  }

  // Find ANY form - try multiple patterns
  let formMatch = html.match(/<form[^>]*id=["']contact-form["'][^>]*>[\s\S]*?<\/form>/i);
  
  if (!formMatch) {
    // Try to find any form with "contact" in the id
    formMatch = html.match(/<form[^>]*id=["'][^"']*contact[^"']*["'][^>]*>[\s\S]*?<\/form>/i);
  }
  
  if (!formMatch) {
    // Try to find any form element at all
    formMatch = html.match(/<form[^>]*>[\s\S]*?<\/form>/i);
  }
  
  if (!formMatch) {
    console.log(`⚠️ Could not find any form element in ${pageName}`);
    return html;
  }

  let form = formMatch[0];
  const originalForm = form;

  // Add id="contact-form" if it doesn't have it
  if (!form.includes('id="contact-form"') && !form.includes("id='contact-form'")) {
    form = form.replace(/<form/, '<form id="contact-form"');
    console.log(`✅ Added id="contact-form" to form in ${pageName}`);
  }

  // Check if SMS consent already exists
  if (!form.includes('sms-consent') && !form.includes('sms_consent')) {
    // Find the submit button
    const buttonMatch = form.match(/<button[^>]*type=["']submit["'][^>]*>[\s\S]*?<\/button>/i) ||
                       form.match(/<input[^>]*type=["']submit["'][^>]*>/i) ||
                       form.match(/<button[^>]*>[\s\S]*?submit[\s\S]*?<\/button>/i);
    
    if (buttonMatch) {
      const smsConsentHTML = `
  <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
    <input type="checkbox" id="sms-consent" name="sms_consent" required style="width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0; cursor: pointer;">
    <label for="sms-consent" style="font-size: 14px; line-height: 1.5; color: ${textColor}; cursor: pointer;">
      I agree to receive text messages at the number provided. Message and data rates may apply. Reply STOP to opt out.
    </label>
  </div>
  `;
      
      form = form.replace(buttonMatch[0], smsConsentHTML + buttonMatch[0]);
      console.log(`✅ Added SMS consent to ${pageName}`);
    } else {
      console.log(`⚠️ Could not find submit button in form in ${pageName}`);
    }
  } else {
    console.log(`✅ SMS consent already exists in ${pageName}`);
  }

  // Add form status div if missing
  if (!form.includes('form-status')) {
    form = form.replace('</form>', '  <div id="form-status" style="display: none; margin-top: 16px; padding: 12px; border-radius: 8px; text-align: center; font-weight: 500;"></div>\n</form>');
  }

  // Replace form in HTML
  html = html.replace(originalForm, form);
  
  // Remove any existing contact form scripts
  html = html.replace(/<script[^>]*>[\s\S]*?contact.*form[\s\S]*?<\/script>/gi, '');

  const submissionScript = `
<script>
(function() {
  const form = document.getElementById('contact-form');
  if (!form) {
    console.error('Contact form not found!');
    return;
  }
  
  // Remove any existing event listeners
  const newForm = form.cloneNode(true);
  form.parentNode.replaceChild(newForm, form);
  
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const button = e.target.querySelector('button[type="submit"]') || e.target.querySelector('.submit-button') || e.target.querySelector('button');
    const statusEl = document.getElementById('form-status');
    
    const smsConsent = formData.get('sms_consent') === 'on';
    if (!smsConsent) {
      if (statusEl) {
        statusEl.textContent = '⚠️ Please agree to receive text messages to continue.';
        statusEl.style.display = 'block';
        statusEl.style.background = '#fef3c7';
        statusEl.style.color = '#92400e';
        statusEl.style.border = '2px solid #fbbf24';
      } else {
        alert('Please agree to receive text messages to continue.');
      }
      return;
    }
    
    const originalButtonText = button ? button.textContent : '';
    if (button) {
      button.textContent = 'Sending...';
      button.disabled = true;
    }
    
    try {
      const userId = document.querySelector('meta[name="user-id"]')?.content || '${userId}';
      
      if (!userId || userId === 'USER_ID_PLACEHOLDER') {
        throw new Error('User ID not configured');
      }
      
      const name = formData.get('name') || formData.get('full_name') || formData.get('fullname') || '';
      const email = formData.get('email') || formData.get('email_address') || '';
      const phone = formData.get('phone') || formData.get('phone_number') || formData.get('tel') || '';
      const service = formData.get('service') || formData.get('service_interested_in') || formData.get('vehicle_make_model') || formData.get('service_type') || '';
      const message = formData.get('message') || formData.get('additional_details') || formData.get('comments') || '';
      
      const response = await fetch('${apiUrl}/api/leads/public/' + userId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          email: email,
          phone: phone,
          service: service,
          message: message,
          sms_consent: true,
          source: 'lead_form'
        })
      });
      
      if (response.ok) {
        if (statusEl) {
          statusEl.textContent = '✅ Thanks! We\\'ll be in touch soon.';
          statusEl.style.display = 'block';
          statusEl.style.background = '#d1fae5';
          statusEl.style.color = '#065f46';
          statusEl.style.border = '2px solid #6ee7b7';
        } else {
          alert('✅ Thanks! We\\'ll be in touch soon.');
        }
        e.target.reset();
      } else {
        throw new Error('Submission failed');
      }
    } catch (error) {
      console.error('Form error:', error);
      if (statusEl) {
        statusEl.textContent = '❌ Something went wrong. Please try again or call us directly.';
        statusEl.style.display = 'block';
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
        statusEl.style.border = '2px solid #fca5a5';
      } else {
        alert('❌ Something went wrong. Please try again or call us directly.');
      }
    } finally {
      if (button) {
        button.textContent = originalButtonText;
        button.disabled = false;
      }
    }
  });
})();
</script>`;

  html = html.replace('</body>', submissionScript + '\n</body>');
  console.log(`✅ Updated form submission script in ${pageName}`);
  
  return html;
}

    const pagesFixed = [];
    let updatedPages = { ...pages };
    let updatedHtmlContent = website.html_content;

    // Fix contact forms in ALL pages
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        const originalHTML = pages[pageKey];
        const fixedHTML = fixContactFormHTML(originalHTML, pageKey);
        
        if (fixedHTML !== originalHTML) {
          updatedPages[pageKey] = fixedHTML;
          pagesFixed.push(pageKey);
        }
      });
    }

    // Also check html_content (main page)
    if (website.html_content) {
      const fixedMainPage = fixContactFormHTML(website.html_content, 'index.html (main)');
      
      if (fixedMainPage !== website.html_content) {
        updatedHtmlContent = fixedMainPage;
        pagesFixed.push('index.html');
      }
    }

    if (pagesFixed.length === 0) {
      return res.status(404).json({ 
        error: 'No contact forms found on any pages',
        message: 'Your website does not appear to have any contact forms to fix'
      });
    }

    // Update database with ALL changes at once
    await pool.query(
      'UPDATE websites SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
      [updatedHtmlContent, updatedPages, userId]
    );

    console.log(`✅ Fixed contact forms on ${pagesFixed.length} page(s): ${pagesFixed.join(', ')}`);

    // AUTO-REDEPLOY - Call the publish endpoint internally
    let redeployed = false;
    let deployUrl = website.vercel_url;

    try {
      console.log('🚀 Auto-triggering publish...');
      
      const vercelToken = process.env.VERCEL_TOKEN;
      
      if (!vercelToken) {
        console.warn('⚠️ No Vercel token - skipping auto-deploy');
      } else {
        // Prepare files for deployment
        const files = [];
        const addedFiles = new Set();

        // Add all pages
        if (updatedPages && Object.keys(updatedPages).length > 0) {
          Object.keys(updatedPages).forEach(pageKey => {
            if (!addedFiles.has(pageKey)) {
              files.push({
                file: pageKey,
                data: Buffer.from(updatedPages[pageKey]).toString('base64')
              });
              addedFiles.add(pageKey);
            }
          });
        }

        // Add index.html if not already added
        if (updatedHtmlContent && !addedFiles.has('index.html')) {
          files.push({
            file: 'index.html',
            data: Buffer.from(updatedHtmlContent).toString('base64')
          });
          addedFiles.add('index.html');
        }

        console.log(`📦 Auto-deploy: ${files.length} files`);

        if (files.length > 0) {
          const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${vercelToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: `website-${userId}`,
              files: files,
              projectSettings: {
                framework: null
              }
            })
          });

          if (deployResponse.ok) {
            const deployData = await deployResponse.json();
            deployUrl = `https://${deployData.url}`;
            
            await pool.query(
              'UPDATE websites SET vercel_url = $1, vercel_deployment_id = $2 WHERE user_id = $3',
              [deployUrl, deployData.id, userId]
            );
            
            redeployed = true;
            console.log(`✅ Auto-deployed to ${deployUrl}`);
          } else {
            const errorText = await deployResponse.text();
            console.error('❌ Auto-deploy failed:', errorText);
          }
        }
      }
    } catch (error) {
      console.error('Auto-deploy error:', error);
      // Don't fail the whole request - just mark as not redeployed
    }

    res.json({
      success: true,
      pagesFixed,
      message: redeployed 
        ? `Contact form(s) updated and published! Live at ${deployUrl}` 
        : `Contact form(s) updated. Click "Publish Changes" to go live.`,
      redeployed,
      deployUrl
    });

  } catch (error) {
    console.error('Error fixing contact form:', error);
    res.status(500).json({ error: 'Failed to fix contact form' });
  }
});
 
// POST - Toggle publish status
router.post('/publish', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { isPublished } = req.body;

    const result = await pool.query(
      `UPDATE websites 
       SET is_published = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2
       RETURNING *`,
      [isPublished, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Website not found' });
    }

    res.json({ 
      success: true,
      website: result.rows[0] 
    });
  } catch (error) {
    console.error('Error toggling publish:', error);
    res.status(500).json({ error: 'Failed to toggle publish' });
  }
});

// POST - AI Website Generation
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { 
      businessName, 
      businessType, 
      tagline,
      services, 
      yearsInBusiness,
      certifications,
      description, 
      uniqueSellingPoints,
      targetCustomer
    } = req.body;

    const safeBusinessName = sanitizeForPrompt(businessName);
    const safeBusinessType = sanitizeForPrompt(businessType);
    const safeTagline = sanitizeForPrompt(tagline);
    const safeServices = sanitizeForPrompt(services);
    const safeCertifications = sanitizeForPrompt(certifications);
    const safeDescription = sanitizeForPrompt(description);
    const safeUSPs = sanitizeForPrompt(uniqueSellingPoints);
    const safeTargetCustomer = sanitizeForPrompt(targetCustomer);

    console.log('🎨 Generating website for:', safeBusinessName);

    if (!safeBusinessName || !safeBusinessType) {
      return res.status(400).json({ error: 'Business name and type are required' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ ANTHROPIC_API_KEY not set!');
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Fetch user data from database
    let userServices = [];
    let userBusinessHours = [];
    let userEmployees = [];
    let userBusinessInfo = null;

    try {
      const servicesResult = await pool.query(
        'SELECT * FROM services WHERE user_id = $1 AND active = true ORDER BY name',
        [userId]
      );
      userServices = servicesResult.rows;

      const hoursResult = await pool.query(
        'SELECT * FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
        [userId]
      );
      userBusinessHours = hoursResult.rows;

      const employeesResult = await pool.query(
        'SELECT name FROM employees WHERE user_id = $1 AND active = true ORDER BY name LIMIT 10',
        [userId]
      );
      userEmployees = employeesResult.rows;

      const businessInfoResult = await pool.query(
        `SELECT bi.*, u.business_name, u.name as owner_name
         FROM business_information bi
         LEFT JOIN users u ON bi.user_id = u.id
         WHERE bi.user_id = $1`,
        [userId]
      );

      if (businessInfoResult.rows.length > 0) {
        userBusinessInfo = businessInfoResult.rows[0];
      } else {
        const userResult = await pool.query(
          'SELECT business_name, name, email, phone FROM users WHERE id = $1',
          [userId]
        );
        userBusinessInfo = userResult.rows[0];
      }

      console.log('✅ Fetched user data');
    } catch (error) {
      console.error('⚠️ Error fetching user data:', error);
    }

    // Format services
    const servicesInfo = userServices.length > 0 
      ? {
          hasData: true,
          services: userServices.map(s => `
**${sanitizeForPrompt(s.name)}**
Description: ${sanitizeForPrompt(s.description) || 'Professional service'}
Price: $${parseFloat(s.price).toFixed(2)}${s.duration_hours ? ` (${s.duration_hours} hour${s.duration_hours > 1 ? 's' : ''})` : ''}
`).join('\n'),
          instruction: `IMPORTANT: Use these EXACT ${userServices.length} services with their real names, descriptions, and prices.`
        }
      : {
          hasData: false,
          services: safeServices || `General ${safeBusinessType} services`,
          instruction: `CRITICAL: Create 4-6 SPECIFIC ${safeBusinessType} services with realistic names, prices ($50-$5000), and durations (1-8 hours).`
        };

    // Format business hours
    const hoursInfo = userBusinessHours.length > 0 && userBusinessHours.some(h => h.is_open)
      ? (() => {
          const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const openDays = userBusinessHours.filter(h => h.is_open);
          
          if (openDays.length === 0) {
            return {
              hasData: false,
              hours: 'Monday-Friday: 9:00 AM - 5:00 PM\nSaturday: 10:00 AM - 2:00 PM\nSunday: Closed',
              instruction: 'Use these typical business hours.'
            };
          }
          
          const hoursText = openDays.map(h => 
            `${daysMap[h.day_of_week]}: ${h.open_time} - ${h.close_time}`
          ).join('\n');
          
          return {
            hasData: true,
            hours: hoursText,
            instruction: 'IMPORTANT: Use these EXACT business hours.'
          };
        })()
      : {
          hasData: false,
          hours: 'Monday-Friday: 9:00 AM - 5:00 PM\nSaturday: 10:00 AM - 2:00 PM\nSunday: Closed',
          instruction: 'Use these typical business hours.'
        };

    // Format team
    const teamInfo = userEmployees.length > 0
      ? {
          hasData: true,
          team: `Our team includes: ${userEmployees.map(e => sanitizeForPrompt(e.name)).join(', ')}`,
          instruction: 'You can mention these team members.'
        }
      : { hasData: false, team: null, instruction: '' };

    // Contact info
    const contactEmail = sanitizeForPrompt(userBusinessInfo?.email) || 'contact@example.com';
    const ownerName = sanitizeForPrompt(userBusinessInfo?.owner_name || userBusinessInfo?.name) || null;
    const phoneNumber = sanitizeForPrompt(userBusinessInfo?.phone) || '(555) 123-4567';
    const phoneNumberClean = phoneNumber.replace(/\D/g, '');

    const address = sanitizeForPrompt(userBusinessInfo?.address) || null;
    const city = sanitizeForPrompt(userBusinessInfo?.city) || null;
    const state = sanitizeForPrompt(userBusinessInfo?.state) || null;
    const zipCode = sanitizeForPrompt(userBusinessInfo?.zip_code) || null;

    const fullAddress = [address, city, state, zipCode].filter(Boolean).join(', ');

    const serviceAreaType = userBusinessInfo?.service_area_type || 'zipcodes';
    const serviceZipCodes = userBusinessInfo?.service_zip_codes || [];
    const serviceRadius = userBusinessInfo?.service_radius || 25;
    const centerZipCode = sanitizeForPrompt(userBusinessInfo?.center_zip_code) || zipCode;

    const serviceAreaText = serviceAreaType === 'radius'
      ? `We serve a ${serviceRadius} mile radius from ${centerZipCode || 'our location'}`
      : serviceZipCodes.length > 0
        ? `Service Areas: ${serviceZipCodes.slice(0, 10).join(', ')}${serviceZipCodes.length > 10 ? ' and more' : ''}`
        : null;

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const bookingUrl = `${frontendUrl}/book/${userId}`;

    // Colors
    const businessTypeLower = safeBusinessType.toLowerCase();
    let primaryColor = '#2563eb';
    let accentColor = '#10b981';
    
    if (businessTypeLower.includes('auto') || businessTypeLower.includes('detail')) {
      primaryColor = '#000000';
      accentColor = '#D4AF37';
    } else if (businessTypeLower.includes('land')) {
      primaryColor = '#047857';
      accentColor = '#16a34a';
    } else if (businessTypeLower.includes('plumb')) {
      primaryColor = '#1e40af';
      accentColor = '#f97316';
    }

    // Build prompt
    const prompt = buildVisualSupremacyPrompt({
      safeBusinessName,
      safeBusinessType,
      safeTagline,
      safeDescription,
      safeUSPs,
      yearsInBusiness,
      safeCertifications,
      safeTargetCustomer,
      phoneNumber,
      phoneNumberClean,
      contactEmail,
      fullAddress,
      serviceAreaText,
      bookingUrl,
      ownerName,
      servicesInfo,
      hoursInfo,
      teamInfo,
      primaryColor,
      accentColor
    });

    console.log('📏 Prompt size:', prompt.length, 'characters');
console.log('📏 Prompt size:', (prompt.length / 1024).toFixed(2), 'KB');

 // Call Claude API using axios (no timeout limits)
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 40000,
        temperature: 0.5,
        messages: [{
          role: 'user',
          content: prompt
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        timeout: 0
      }
    );

    const data = response.data;
    const fullResponse = data.content?.[0]?.text;

    if (!fullResponse) {
      console.error('❌ No HTML content in response');
      return res.status(500).json({ error: 'No content generated' });
    }

    // Parse multiple files
    const files = {};
    const fileSeparator = /<!-- FILE_SEPARATOR: (.+?) -->/g;
    const parts = fullResponse.split(fileSeparator);

    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i += 2) {
        const filename = parts[i].trim();
        const content = parts[i + 1]?.trim()
          .replace(/```html\n?/g, '')
          .replace(/```\n?$/g, '')
          .replace(/```/g, '') || '';
        
        if (filename && content) {
          files[filename] = content;
        }
      }
      console.log('✅ Generated', Object.keys(files).length, 'pages');
    } else {
      const cleanContent = fullResponse.trim()
        .replace(/```html\n?/g, '')
        .replace(/```\n?$/g, '')
        .replace(/```/g, '');
      files['index.html'] = cleanContent;
      console.log('✅ Generated single-page website');
    }

    const htmlContent = files['index.html'];

    if (!htmlContent) {
      console.error('❌ No index.html generated');
      return res.status(500).json({ error: 'No homepage content generated' });
    }

    // ============================================
    // INJECT CHAT WIDGET IF DEPLOYED
    // ============================================
    const chatAgentResult = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    const chatAgentDeployed = chatAgentResult.rows.length > 0 && 
                              chatAgentResult.rows[0].config?.enabled === true;

   // In the /generate route, update the chat widget injection section:
if (chatAgentDeployed) {
  console.log('💬 Chat agent is deployed - injecting widget into website pages');
  const websiteColors = {
    primaryColor: '#667eea',
    accentColor: '#764ba2',
    textColor: '#1f2937'
  };
  const chatWidgetCode = generateChatWidgetCode(userId, chatAgentResult.rows[0].config, websiteColors);
  
  let widgetInjected = false;
  Object.keys(files).forEach(filename => {
    if (files[filename].includes('</body>')) {
      files[filename] = files[filename].replace('</body>', chatWidgetCode + '\n</body>');
      console.log(`✅ Injected chat widget into ${filename}`);
      widgetInjected = true;
    } else {
      console.log(`⚠️ No </body> tag found in ${filename}, skipping widget injection`);
    }
  });
  
  if (!widgetInjected) {
    console.error('❌ WARNING: Chat widget was NOT injected into any files!');
  }
} else {
  console.log('ℹ️ Chat agent not deployed - skipping widget injection');
}
    // ============================================

    res.json({ 
      success: true, 
      html: files['index.html'], // Now returns the potentially updated version with chat widget
      pages: files,
      businessName: safeBusinessName,
      bookingUrl,
      phoneNumber,
      address: fullAddress || null,
      serviceArea: serviceAreaText || null,
      pageNames: Object.keys(files),
      chatWidgetInjected: chatAgentDeployed, // Let frontend know if widget was added
      usedRealData: {
        services: servicesInfo.hasData,
        hours: hoursInfo.hasData,
        team: teamInfo.hasData,
        phone: !!userBusinessInfo?.phone,
        address: !!fullAddress,
        serviceArea: !!serviceAreaText
      }
    });

  } catch (error) {
    console.error('❌ Error generating website:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});
// POST - Deploy website to Vercel
// POST - Deploy website to Vercel
router.post('/deploy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get website content AND pages
    const websiteResult = await pool.query(
      'SELECT html_content, pages FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Website not found' });
    }

    const htmlContent = websiteResult.rows[0].html_content;
    const pagesJson = websiteResult.rows[0].pages;
    
    // Parse pages if they exist
    let pages = null;
    if (pagesJson) {
      pages = typeof pagesJson === 'string' ? JSON.parse(pagesJson) : pagesJson;
    }

    // Deploy to Vercel with all pages
    const deploymentUrl = await deployToVercel(userId, htmlContent, pages);

    // Save Vercel URL to database
    await pool.query(
      'UPDATE websites SET vercel_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
      [deploymentUrl, userId]
    );

    res.json({ success: true, url: deploymentUrl });
  } catch (error) {
    console.error('Error deploying website:', error);
    res.status(500).json({ error: 'Failed to deploy website' });
  }
});
// POST - Connect existing website
router.post('/connect-existing', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    let websiteUrl;
    try {
      websiteUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Fetch the website HTML
    const response = await fetch(websiteUrl.href);
    if (!response.ok) {
      return res.status(400).json({ error: 'Failed to fetch website. Make sure the URL is accessible.' });
    }

    const htmlContent = await response.text();

    // Save to database
    const result = await pool.query(
      `INSERT INTO websites (user_id, html_content, url, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET 
         html_content = $2,
         url = $3,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, html_content, url`,
      [userId, htmlContent, websiteUrl.href]
    );

    console.log('✅ Connected existing website for user:', userId);

    res.json({
      success: true,
      html_content: result.rows[0].html_content,
      url: result.rows[0].url,
      website_id: result.rows[0].id
    });

  } catch (error) {
    console.error('❌ Connect website error:', error);
    res.status(500).json({ error: 'Failed to connect website' });
  }
});

// POST - Search for available domains
router.post('/search-domains', authenticateToken, async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required' });
    }

    console.log('🔍 Searching domains for:', query.trim());

    // Search for available domains
    const domains = await searchDomains(query.trim());

    console.log('📋 Search results:', domains);

    res.json({ success: true, domains });
  } catch (error) {
    console.error('Error searching domains:', error);
    res.status(500).json({ error: 'Failed to search domains' });
  }
});

// TEST - Check Porkbun API connection
router.get('/test-porkbun', authenticateToken, async (req, res) => {
  try {
    const axios = require('axios');
    
    // Test API connection
    const response = await axios.post(
      'https://porkbun.com/api/json/v3/ping',
      {
        apikey: process.env.PORKBUN_API_KEY,
        secretapikey: process.env.PORKBUN_SECRET_KEY
      }
    );
    
    res.json({ 
      success: true, 
      message: 'Porkbun API is accessible',
      data: response.data,
      serverIp: req.ip
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Porkbun API blocked',
      message: error.message,
      serverIp: req.ip,
      hint: 'You need to whitelist your Railway IP in Porkbun settings'
    });
  }
});

// POST - Purchase domain (managed by us)
router.post('/purchase-domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: 'Domain required' });
    }

    // Get user info
    const userResult = await pool.query(
      'SELECT email, business_name FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Purchase domain through domain registrar
    const purchaseResult = await purchaseDomain(domain, {
      email: user.email,
      businessName: user.business_name
    });

    // Add domain to Vercel
    await addDomainToVercel(domain, userId);

    // Save to database
    await pool.query(
      `UPDATE websites 
       SET custom_domain = $1, 
           domain_verified = true, 
           domain_managed_by_us = true,
           domain_purchase_date = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $2`,
      [domain, userId]
    );

    // Create subscription record for $15/year billing
    await pool.query(
      `INSERT INTO domain_subscriptions (user_id, domain, price_yearly, status, next_billing_date)
       VALUES ($1, $2, 15.00, 'active', CURRENT_DATE + INTERVAL '1 year')`,
      [userId, domain]
    );

    res.json({ 
      success: true, 
      domain,
      message: 'Domain purchased and configured successfully'
    });
  } catch (error) {
    console.error('Error purchasing domain:', error);
    res.status(500).json({ error: error.message || 'Failed to purchase domain' });
  }
});

// POST - Add custom domain (user already owns it)
router.post('/add-domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: 'Domain required' });
    }

    // Validate domain format
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
    if (!domainRegex.test(domain.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    // Add domain to Vercel
    await addDomainToVercel(domain, userId);

    // Save to database
    await pool.query(
      `UPDATE websites 
       SET custom_domain = $1, 
           domain_verified = false, 
           domain_managed_by_us = false,
           updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $2`,
      [domain, userId]
    );

    res.json({ success: true, domain });
  } catch (error) {
    console.error('Error adding domain:', error);
    res.status(500).json({ error: 'Failed to add domain' });
  }
});

// GET - Check domain verification status
router.get('/domain-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT custom_domain, domain_verified FROM websites WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].custom_domain) {
      return res.json({ verified: false });
    }

    const domain = result.rows[0].custom_domain;
    
    // If already verified in DB, return true
    if (result.rows[0].domain_verified) {
      return res.json({ verified: true });
    }

    // Check with Vercel
    const isVerified = await checkDomainVerification(domain, userId);

    // Update database if now verified
    if (isVerified) {
      await pool.query(
        'UPDATE websites SET domain_verified = true, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
        [userId]
      );
    }

    res.json({ verified: isVerified });
  } catch (error) {
    console.error('Error checking domain status:', error);
    res.status(500).json({ error: 'Failed to check domain status' });
  }
});

// DELETE - Remove domain
router.delete('/remove-domain', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get current domain
    const result = await pool.query(
      'SELECT custom_domain, domain_managed_by_us FROM websites WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].custom_domain) {
      return res.status(404).json({ error: 'No domain found' });
    }

    const domain = result.rows[0].custom_domain;
    const managedByUs = result.rows[0].domain_managed_by_us;

    // Try to remove from Vercel (don't fail if project doesn't exist)
    try {
      await removeDomainFromVercel(domain, userId);
    } catch (error) {
      console.warn('Could not remove from Vercel (continuing anyway):', error.message);
      // Don't fail the whole operation - just log it
    }

    // If we manage the domain, cancel subscription
    if (managedByUs) {
      await pool.query(
        `UPDATE domain_subscriptions 
         SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP 
         WHERE user_id = $1 AND domain = $2`,
        [userId, domain]
      );
    }

    // Clear domain from database
    await pool.query(
      `UPDATE websites 
       SET custom_domain = NULL, 
           domain_verified = false, 
           domain_managed_by_us = false,
           updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1`,
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing domain:', error);
    res.status(500).json({ error: 'Failed to remove domain' });
  }
});

module.exports = router;
module.exports.generateChatWidgetCode = generateChatWidgetCode;
