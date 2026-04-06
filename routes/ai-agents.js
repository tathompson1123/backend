const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requirePlan } = require('../config/middleware');
const { logClaudeUsage } = require('../utils/claudeUsage');

// Debug endpoint to verify agent config state
router.get('/debug/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      'SELECT id, user_id, agent_type, config, updated_at FROM agent_configs WHERE user_id = $1',
      [userId]
    );
    console.log('🔍 Debug config for user', userId, ':', result.rows.length, 'rows');
    res.json({
      userId,
      rows: result.rows.map(r => ({
        id: r.id,
        agent_type: r.agent_type,
        config: r.config,
        updated_at: r.updated_at
      }))
    });
  } catch (error) {
    console.error('Debug config error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Website Chat Agent - Get config (no plan gate — users can configure before upgrading)
router.get('/website/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    console.log('📖 Loading chat config for user', userId, '- found:', result.rows.length, 'rows');

    if (result.rows.length === 0) {
      console.log('📖 No config found, returning defaults');
      return res.json({
        config: {
          enabled: true,
          agentName: 'Kurt',
          greetingMessage: "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?",
          autoOpenDelay: 14,
          personality: 'friendly',
          responseLength: 'concise',
          captureStrategy: 'natural',
          customInstructions: '',
          enableBooking: true,
          enableLeadCapture: true
        }
      });
    }

    console.log('📖 Returning saved config:', Object.keys(result.rows[0].config || {}).join(', '));
    res.json({ config: result.rows[0].config });
  } catch (error) {
    console.error('Error fetching website agent config:', error.message);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

router.get('/website/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );
    
    const isDeployed = result.rows.length > 0 && result.rows[0].config?.enabled === true;
    
    res.json({ isDeployed });
  } catch (error) {
    console.error('Error checking website agent status:', error.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// GET - Check if lead form agent is deployed
router.get('/leadform/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );
    
    const isDeployed = result.rows.length > 0 && result.rows[0].config?.enabled === true;
    
    res.json({ isDeployed });
  } catch (error) {
    console.error('Error checking lead form agent status:', error.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Website Chat Agent - Save config
// Save config (no plan gate — users can configure before upgrading, deployment still requires pro)
router.post('/website/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get existing config to merge (prevents losing fields on partial updates)
    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );
    const existingConfig = existing.rows[0]?.config || {};

    // Whitelist allowed fields, filter out null/undefined
    const allowedFields = [
      'agentName', 'greetingMessage', 'autoOpenDelay',
      'personality', 'responseLength', 'captureStrategy',
      'customInstructions', 'enableBooking', 'enableLeadCapture',
      'objectionServices', 'objectionNotes', 'requireCardOnFile'
    ];

    const incoming = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined && req.body[field] !== null) {
        incoming[field] = req.body[field];
      }
    }
    // Allow explicit false/empty string (only filter null/undefined)
    if (req.body.enableBooking === false) incoming.enableBooking = false;
    if (req.body.enableLeadCapture === false) incoming.enableLeadCapture = false;
    if (req.body.requireCardOnFile === false) incoming.requireCardOnFile = false;
    if (req.body.customInstructions === '') incoming.customInstructions = '';

    const config = { ...existingConfig, ...incoming, enabled: true };

    console.log('💾 Saving chat config for user', userId, ':', Object.keys(incoming).join(', '));

    const result = await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, agent_type)
       DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, 'website_chat', JSON.stringify(config)]
    );

    console.log('✅ Chat config saved for user', userId);
    res.json({ success: true, config: result.rows[0].config });
  } catch (error) {
    console.error('Error saving website agent config:', error.message);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// Website Chat Agent - Get stats
router.get('/website/stats', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const conversationsResult = await pool.query(
      'SELECT COUNT(*) as count FROM chat_conversations WHERE user_id = $1 AND created_at >= $2',
      [userId, startOfMonth]
    );

    const leadsResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND created_at >= $3',
      [userId, 'ai_chat_agent', startOfMonth]
    );

    const bookingsResult = await pool.query(
      'SELECT COUNT(*) as count FROM bookings WHERE user_id = $1 AND source = $2 AND created_at >= $3',
      [userId, 'ai_chat_agent', startOfMonth]
    );

    res.json({
      conversations: parseInt(conversationsResult.rows[0].count),
      leadsCaptured: parseInt(leadsResult.rows[0].count),
      avgResponse: '2.3s',
      bookingsCreated: parseInt(bookingsResult.rows[0].count)
    });
  } catch (error) {
    console.error('Error fetching website agent stats:', error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Website Chat Agent - Get conversation history
router.get('/website/conversations', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 20;

    // Get recent conversations with their first/last messages
    const convResult = await pool.query(
      `SELECT cc.id, cc.created_at, cc.updated_at,
              (SELECT content FROM chat_messages WHERE conversation_id = cc.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_message,
              (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = cc.id) as message_count,
              l.name as lead_name, l.email as lead_email, l.phone as lead_phone, l.status as lead_status
       FROM chat_conversations cc
       LEFT JOIN leads l ON l.user_id = cc.user_id AND l.source = 'ai_chat_agent'
         AND l.created_at BETWEEN cc.created_at - INTERVAL '1 hour' AND cc.created_at + INTERVAL '1 hour'
       WHERE cc.user_id = $1
       ORDER BY cc.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({ conversations: convResult.rows });
  } catch (error) {
    console.error('Error fetching chat conversations:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Website Chat Agent - Get messages for a specific conversation
router.get('/website/conversations/:id/messages', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    // Verify conversation belongs to user
    const conv = await pool.query(
      'SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });

    const messages = await pool.query(
      'SELECT role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({ messages: messages.rows });
  } catch (error) {
    console.error('Error fetching chat messages:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Website Chat Agent - Toggle
router.patch('/website', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enabled } = req.body;

    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    let config = {
  enabled,
  agentName: 'Kurt',
  greetingMessage: "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?",
  autoOpenDelay: 14  // Changed from 3
};


    if (existing.rows.length > 0 && existing.rows[0].config) {
      config = { ...existing.rows[0].config, enabled };
    }

    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
       ON CONFLICT (user_id, agent_type) 
       DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP`,
      [userId, 'website_chat', JSON.stringify(config)]
    );

    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Error toggling website agent:', error.message);
    res.status(500).json({ error: 'Failed to toggle agent' });
  }
});

// Website Chat Agent - Deploy
router.post('/website/deploy', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;

    console.log('🚀 Deploy request received for user:', userId);

    // 1. Save agent config as deployed
    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    let config = {
  enabled: true,
  agentName: 'Kurt',
  greetingMessage: "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?",
  autoOpenDelay: 14  // Changed from 3
};

    if (existing.rows.length > 0 && existing.rows[0].config) {
      config = { ...existing.rows[0].config, enabled: true };
    }

    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
       ON CONFLICT (user_id, agent_type) 
       DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP`,
      [userId, 'website_chat', JSON.stringify(config)]
    );

    console.log('✅ Agent config saved');

    // 2. Get existing website
    const websiteResult = await pool.query(
      'SELECT html_content, pages, vercel_url FROM websites WHERE user_id = $1',
      [userId]
    );

    if (websiteResult.rows.length === 0) {
      console.log('⚠️ No website found - agent deployed but not injected');
      return res.json({ 
        success: true, 
        message: 'Chat agent deployed! It will be added when you create or update your website.',
        needsWebsite: true
      });
    }

    const website = websiteResult.rows[0];
    let pages = website.pages || {};
    let htmlContent = website.html_content;

    console.log('📄 Found website with', Object.keys(pages).length, 'pages');

    // 3. Generate chat widget code
    const { generateChatWidgetCode } = require('../utils/chatWidget');
    const websiteColors = {
  primaryColor: website.primary_color || '#667eea',
  accentColor: website.accent_color || '#764ba2', 
  textColor: website.text_color || '#1f2937'
};
const chatWidgetCode = generateChatWidgetCode(userId, config, websiteColors);
    console.log('🔧 Generated chat widget code');

    // 4. Inject/replace widget into all pages
    let pagesUpdated = [];
    const widgetRegex = /<!-- SORCE Chat Agent -->[\s\S]*?<!-- End SORCE Chat Agent -->/;

    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        if (pages[pageKey].includes('sorce-chat-widget')) {
          // Replace existing widget with updated version
          pages[pageKey] = pages[pageKey].replace(widgetRegex, chatWidgetCode.trim());
          pagesUpdated.push(pageKey);
          console.log(`🔄 Replaced widget in ${pageKey}`);
        } else if (pages[pageKey].includes('</body>')) {
          pages[pageKey] = pages[pageKey].replace('</body>', chatWidgetCode + '\n</body>');
          pagesUpdated.push(pageKey);
          console.log(`✅ Injected widget into ${pageKey}`);
        }
      });
    }

    if (htmlContent && htmlContent.includes('sorce-chat-widget')) {
      htmlContent = htmlContent.replace(widgetRegex, chatWidgetCode.trim());
      pagesUpdated.push('index.html');
      console.log('🔄 Replaced widget in main html_content');
    } else if (htmlContent && htmlContent.includes('</body>')) {
      htmlContent = htmlContent.replace('</body>', chatWidgetCode + '\n</body>');
      pagesUpdated.push('index.html');
      console.log('✅ Injected widget into main html_content');
    }

    // 5. Update database
    await pool.query(
      'UPDATE websites SET html_content = $1, pages = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
      [htmlContent, pages, userId]
    );

    console.log('✅ Website updated in database');

    res.json({ 
      success: true, 
      message: 'Chat agent deployed! Please manually publish your website to see it live.',
      pagesUpdated,
      needsManualDeploy: true
    });

  } catch (error) {
    console.error('Error deploying website agent:', error.message);
    res.status(500).json({ error: 'Failed to deploy agent' });
  }
});
    
// LEAD FORM AGENT ROUTES
// ============================================

// GET /api/agents/lead-form/config
router.get('/lead-form/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT config, sms_template, email_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (result.rows.length === 0) {
      return res.json({
        config: {
          emailEnabled: true,
          smsEnabled: true,
          followUpEnabled: true,
          autoBookingEnabled: true
        },
        smsTemplate: null,
        emailTemplate: null
      });
    }

    res.json({
      config: result.rows[0].config,
      smsTemplate: result.rows[0].sms_template,
      emailTemplate: result.rows[0].email_template
    });
  } catch (error) {
    console.error('Error loading lead-form config:', error.message);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// POST /api/agents/lead-form/config
router.post('/lead-form/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const config = req.body;

    const { emailTemplate, smsTemplate, ...settings } = config;

    // Check if config exists
    const existing = await pool.query(
      'SELECT id FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (existing.rows.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE agent_configs
         SET config = $1, email_template = $2, sms_template = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4 AND agent_type = $5`,
        [settings, emailTemplate, smsTemplate, userId, 'lead_form']
      );
    } else {
      // Create new
      await pool.query(
        `INSERT INTO agent_configs (user_id, agent_type, config, email_template, sms_template, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, 'lead_form', settings, emailTemplate, smsTemplate]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving lead-form config:', error.message);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// POST /api/agents/lead-form/training - Save AI training data
router.post('/lead-form/training', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      responseTone,
      businessContext,
      faqs,
      commonObjections,
      agentName,
      servicesInfo
    } = req.body;

    const trainingData = {
      responseTone: responseTone || 'friendly',
      businessContext: businessContext || '',
      faqs: faqs || [],
      commonObjections: commonObjections || [],
      agentName: agentName || '',
      servicesInfo: servicesInfo || ''
    };

    // Get existing config
    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (existing.rows.length > 0) {
      const currentConfig = existing.rows[0].config || {};
      await pool.query(
        `UPDATE agent_configs
         SET config = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND agent_type = $3`,
        [{ ...currentConfig, training: trainingData }, userId, 'lead_form']
      );
    } else {
      await pool.query(
        `INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, 'lead_form', { training: trainingData }]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving lead-form training:', error.message);
    res.status(500).json({ error: 'Failed to save training data' });
  }
});

// GET /api/agents/lead-form/training - Get AI training data
router.get('/lead-form/training', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (result.rows.length === 0 || !result.rows[0].config?.training) {
      return res.json({
        responseTone: 'friendly',
        businessContext: '',
        faqs: [],
        commonObjections: [],
        agentName: '',
        servicesInfo: ''
      });
    }

    res.json(result.rows[0].config.training);
  } catch (error) {
    console.error('Error loading lead-form training:', error.message);
    res.status(500).json({ error: 'Failed to load training data' });
  }
});

// GET /api/agents/lead-form/stats
router.get('/lead-form/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const stats = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'contacted_email' THEN 1 END) as emails_sent,
        COUNT(CASE WHEN status = 'contacted_sms' THEN 1 END) as sms_sent,
        COUNT(CASE WHEN status IN ('responded', 'qualified') THEN 1 END) as responses
       FROM leads 
       WHERE user_id = $1 
       AND source = 'lead_form'
       AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [userId]
    );

    const total = parseInt(stats.rows[0].total) || 0;
    const responses = parseInt(stats.rows[0].responses) || 0;
    const responseRate = total > 0 ? Math.round((responses / total) * 100) : 0;

    const bookings = await pool.query(
      `SELECT COUNT(*) as count FROM bookings 
       WHERE user_id = $1 
       AND customer_id IN (
         SELECT id FROM customers WHERE id IN (
           SELECT customer_id FROM leads WHERE source = 'lead_form' AND user_id = $1
         )
       )
       AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [userId]
    );

    res.json({
      total,
      emailsSent: parseInt(stats.rows[0].emails_sent) || 0,
      smsSent: parseInt(stats.rows[0].sms_sent) || 0,
      responseRate,
      bookingsCreated: parseInt(bookings.rows[0].count) || 0
    });
  } catch (error) {
    console.error('Error loading lead-form stats:', error.message);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// POST /api/agents/lead-form/deploy
router.post('/lead-form/deploy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    // Check if already has a number
    const userCheck = await pool.query(
      `SELECT u.twilio_phone_number, u.plan, bi.zip_code
       FROM users u
       LEFT JOIN business_information bi ON bi.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    const userData = userCheck.rows[0];
    let phoneNumber = userData?.twilio_phone_number;

    // Auto-provision phone number if they don't have one
    if (!phoneNumber) {
      try {
        const userPlan = userData?.plan;
        if (userPlan === 'pro' || userPlan === 'scale' || userPlan === 'expert') {
          // Paid plans get a dedicated number based on business zip
          const { purchasePhoneNumber } = require('../utils/twilio');
          const result = await purchasePhoneNumber({
            zipCode: userData?.zip_code,
            userId
          });
          await pool.query(
            'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = $2 WHERE id = $3',
            [result.phoneNumber, result.phoneSid, userId]
          );
          phoneNumber = result.phoneNumber;
          console.log(`✅ Auto-provisioned ${phoneNumber} for user ${userId} (zip: ${userData?.zip_code})`);
        } else {
          // Basic/trial: assign shared number
          const sharedNumber = process.env.TWILIO_SHARED_TRIAL_NUMBER;
          if (sharedNumber) {
            await pool.query(
              'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = NULL WHERE id = $2',
              [sharedNumber, userId]
            );
            phoneNumber = sharedNumber;
            console.log(`✅ Assigned shared trial number ${sharedNumber} to user ${userId}`);
          } else {
            return res.status(500).json({ error: 'SMS not available on trial plan. Please upgrade.' });
          }
        }
      } catch (error) {
        console.error('Error provisioning phone:', error.message);
        return res.status(500).json({
          error: 'Failed to provision phone number. Please contact support.',
          details: error.message
        });
      }
    }

    // Deploy agent config
    const defaultSmsTemplate = `Hi {{name}}! Thanks for reaching out. We received your inquiry about {{service}} and will get back to you within 24 hours. Reply STOP to opt out.`;
    const defaultEmailTemplate = `Hi {{name}},\n\nThank you for contacting us! We received your message about {{service}}.\n\nWe'll review your request and get back to you within 24 hours.\n\nBest regards`;

    const existing = await pool.query(
      'SELECT * FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (existing.rows.length > 0) {
      const currentConfig = existing.rows[0].config || {};
      await pool.query(
        `UPDATE agent_configs 
         SET config = $1, 
             sms_template = COALESCE(sms_template, $2),
             email_template = COALESCE(email_template, $3),
             updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = $4 AND agent_type = $5`,
        [
          { ...currentConfig, enabled: true, smsEnabled: true, emailEnabled: true },
          defaultSmsTemplate,
          defaultEmailTemplate,
          userId,
          'lead_form'
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO agent_configs (user_id, agent_type, config, sms_template, email_template, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          userId,
          'lead_form',
          { enabled: true, smsEnabled: true, emailEnabled: true },
          defaultSmsTemplate,
          defaultEmailTemplate
        ]
      );
    }

    console.log(`✅ Lead form agent deployed for user ${userId}`);
    res.json({ 
      success: true, 
      message: 'Lead form agent deployed successfully',
      phoneNumber 
    });
  } catch (error) {
    console.error('Error deploying lead form agent:', error.message);
    res.status(500).json({ error: 'Failed to deploy agent' });
  }
});

// GET /api/agents/leadform/status (keep old route for compatibility)
router.get('/leadform/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    const isDeployed = result.rows.length > 0 && result.rows[0].config?.enabled === true;
    res.json({ isDeployed });
  } catch (error) {
    console.error('Error checking lead form agent status:', error.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ============================================
// PREVIEW & ASSISTANT ENDPOINTS
// ============================================

// POST /api/agents/preview-chat - Test agent responses in preview mode
// Uses the SAME system prompt as the deployed chat.js endpoint + agent config
router.post('/preview-chat', authenticateToken, async (req, res) => {
  try {
    const { message, config, agentType, history = [] } = req.body;
    const userId = req.user.userId;

    if (!message || !config) {
      return res.status(400).json({ error: 'Message and config are required' });
    }

    // Get user's business info (same queries as deployed chat.js)
    const userInfoResult = await pool.query(
      `SELECT u.business_name, u.phone, u.email,
              bi.address, bi.city, bi.state
       FROM users u
       LEFT JOIN business_information bi ON u.id = bi.user_id
       WHERE u.id = $1`,
      [userId]
    );
    const userInfo = userInfoResult.rows[0] || {};
    const businessName = userInfo.business_name || 'Our business';

    // Get services with IDs (same as deployed)
    const servicesResult = await pool.query(
      'SELECT id, name, description, price, duration_hours FROM services WHERE user_id = $1 AND active = true',
      [userId]
    );

    // Get business hours (same as deployed)
    const hoursResult = await pool.query(
      'SELECT day_of_week, open_time, close_time, is_open FROM business_hours WHERE user_id = $1 ORDER BY day_of_week',
      [userId]
    );
    const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const businessHours = hoursResult.rows
      .filter(h => h.is_open)
      .map(h => `${daysMap[h.day_of_week]}: ${h.open_time} - ${h.close_time}`)
      .join('\n');

    let systemPrompt = '';

    if (agentType === 'chat') {
      // Matches deployed chat.js structure + agent config personality/objection handling
      systemPrompt = `You are ${config.agentName || 'Kurt'}, a ${config.personality || 'friendly'} assistant for ${businessName} helping customers book services.

Response style: Be ${config.responseLength || 'concise'} in your responses.
${config.customInstructions ? `\nSpecial instructions: ${config.customInstructions}` : ''}

Available services:
${servicesResult.rows.map(s => `- ${s.name} (ID: ${s.id}): $${s.price} - ${s.description || 'No description'} (${s.duration_hours} hours)`).join('\n') || 'No services configured yet.'}

Business Hours:
${businessHours || 'Monday-Friday: 9:00 AM - 5:00 PM'}

Contact: ${userInfo.phone || 'N/A'}
Email: ${userInfo.email || 'N/A'}
Address: ${[userInfo.address, userInfo.city, userInfo.state].filter(Boolean).join(', ') || 'N/A'}

CONVERSATION FLOW - Follow these stages in order:

STAGE 1 - IDENTIFY THE PROBLEM:
- Ask what they're looking to get done
- Listen to their needs and pain points
- Be conversational and ${config.personality || 'friendly'}

STAGE 2 - RECOMMEND SERVICES:
- Based on their problem, suggest 1-3 relevant services from the list above
- Explain briefly why each service fits their needs
- Mention the price and duration for each
- Ask which service interests them most

STAGE 3 - GATHER BOOKING DETAILS (only after they choose a service):
Ask ONE question at a time in this order:
1. First, ask: "What day works best for you?"
2. Then ask: "What time would you prefer?"
3. Then ask: "Can I get your name?"
4. Then ask: "What's the best email to send your confirmation?"
5. Finally ask: "And your phone number?"

STAGE 4 - CONFIRM AND BOOK:
Once you have ALL information, confirm the booking details and let them know it's booked.

OBJECTION HANDLING:
- When a customer expresses hesitation about price, timing, or need, acknowledge their concern first
- Use social proof: mention satisfaction rates and experience
- If price is the objection, highlight the value and long-term savings
${config.objectionServices ? `- You may offer these complimentary add-ons to close hesitant customers: ${config.objectionServices}` : '- If appropriate, offer to include a small bonus service to sweeten the deal'}
${config.objectionNotes ? `- Additional objection handling notes: ${config.objectionNotes}` : ''}
- Never be pushy — be understanding and helpful while gently addressing concerns
- If they still decline, leave the door open: "No problem at all! We're here whenever you're ready."

Lead capture strategy: ${config.captureStrategy === 'early' ? 'Ask for contact info within the first 2-3 messages' : config.captureStrategy === 'booking' ? 'Only ask for contact info when booking' : 'Ask naturally when relevant'}

IMPORTANT RULES:
- Only ask for ONE piece of information per message
- Don't skip stages - follow the order
- Use natural, conversational language — write like a real human texting, not a formatted document
- NEVER use markdown formatting. No asterisks for bold (**word**), no dashes for bullet points (- item), no underscores, no hashtags. Use plain sentences with commas, periods, exclamation marks, and question marks only.
- If they're just asking questions, answer them and don't force the booking flow
- This is a preview — simulate the full experience naturally
- Today's date is ${new Date().toISOString().split('T')[0]}`;
    } else {
      // Lead form agent - SMS style
      systemPrompt = `You are ${config.agentName || 'Kurt'}, responding via SMS for ${businessName}.

Tone: ${config.responseTone || 'friendly'}

Business context: ${config.businessContext || 'Local service business'}
Services info: ${config.servicesInfo || servicesResult.rows.map(s => s.name).join(', ') || 'Various services available'}

Keep responses SHORT (under 160 characters ideally for SMS).
Write like a real human texting — use plain sentences with commas, periods, exclamations, and question marks. NEVER use asterisks, dashes, bullet points, or any markdown formatting.
Be conversational and helpful.
${config.followUpEnabled ? 'If they seem interested, try to schedule a call or appointment.' : ''}
${config.autoBookingEnabled ? 'If they mention a date/time, confirm booking details.' : ''}`;
    }

    // Build conversation history for Claude
    const messages = [
      ...history.map(h => ({
        role: h.role,
        content: h.content
      })),
      { role: 'user', content: message }
    ];

    // Call Claude API
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: messages
    });
    logClaudeUsage(userId, 'claude-sonnet-4-20250514', response.usage, 'preview_chat');

    let reply = response.content[0]?.text || "I'm here to help! How can I assist you today?";

    // Strip any BOOKING_REQUEST lines (preview doesn't create real bookings)
    reply = reply.replace(/BOOKING_REQUEST\|[^\n]+\n?/g, '');

    res.json({ reply });
  } catch (error) {
    console.error('Error in preview-chat:', error.message);
    res.status(500).json({ error: 'Failed to generate preview response' });
  }
});

// POST /api/agents/assistant - Claude assistant to help configure agents
router.post('/assistant', authenticateToken, async (req, res) => {
  try {
    const { prompt, currentConfig, agentType, conversationHistory = [] } = req.body;
    const userId = req.user.userId;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Get user's business info for context
    const [userResult, bizResult, servicesResult, hoursResult] = await Promise.all([
      pool.query('SELECT business_name, email FROM users WHERE id = $1', [userId]),
      pool.query('SELECT phone, email, address, city, state, zip_code, service_area_type, service_zip_codes, service_radius FROM business_information WHERE user_id = $1', [userId]),
      pool.query('SELECT name, description, price FROM services WHERE user_id = $1 LIMIT 20', [userId]),
      pool.query('SELECT day_of_week, open_time, close_time, is_open FROM business_hours WHERE user_id = $1 ORDER BY day_of_week', [userId])
    ]);
    const businessName = userResult.rows[0]?.business_name || '';
    const accountEmail = userResult.rows[0]?.email || '';
    const bizInfo = bizResult.rows[0] || {};
    const services = servicesResult.rows;
    const hours = hoursResult.rows;

    // Build rich business context string
    const bizContext = [
      businessName ? `Business name: ${businessName}` : null,
      bizInfo.phone ? `Phone: ${bizInfo.phone}` : null,
      (bizInfo.email || accountEmail) ? `Email: ${bizInfo.email || accountEmail}` : null,
      bizInfo.address ? `Address: ${[bizInfo.address, bizInfo.city, bizInfo.state, bizInfo.zip_code].filter(Boolean).join(', ')}` : null,
      bizInfo.service_area_type === 'radius' && bizInfo.service_radius ? `Service area: ${bizInfo.service_radius} mile radius` : null,
      bizInfo.service_area_type === 'zipcodes' && bizInfo.service_zip_codes?.length ? `Service zip codes: ${bizInfo.service_zip_codes.join(', ')}` : null,
      services.length > 0 ? `Services: ${services.map(s => `${s.name}${s.price ? ` ($${s.price})` : ''}`).join(', ')}` : null,
      hours.length > 0 ? `Business hours: ${hours.filter(h => h.is_open).map(h => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][h.day_of_week]} ${h.open_time}-${h.close_time}`).join(', ')}` : null,
    ].filter(Boolean);

    const hasBusinessInfo = businessName || bizInfo.phone || services.length > 0;

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const systemPrompt = agentType === 'missedcall'
      ? `You are the SORCE AI Assistant, helping users configure their Missed Call Text-Back Agent.

CRITICAL — CHECK FIRST:
Look at the CURRENT CONFIGURATION below. If ANY of these are true, the agent is ALREADY configured:
- ringToNumber is set (not empty)
- training.businessContext is NOT empty
- training.servicesInfo is NOT empty
If the agent IS already configured: greet with "Your Missed Call Agent is configured. What would you like to change?" and let them modify specific settings. Do NOT restart the interview.
Only run the full interview below if ALL fields are clearly still defaults.

YOUR ROLE: Ask specific questions to understand how the user wants missed calls handled. DO NOT suggest tone or style - ASK what they want and apply it exactly.

USER'S BUSINESS (from their settings — DO NOT ask about info that's already here):
${bizContext.length > 0 ? bizContext.join('\n') : 'No business info set yet.'}

CURRENT CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

CONFIGURABLE OPTIONS (guide the user through these — they enter the values in the Manual Setup form):
1. ringToNumber - The phone number where calls ring first (their cell/business phone)
2. ringTimeout - Seconds before the call is considered "missed" (default: 20s)
3. smsTemplate - Auto-text after a missed call (can use {{name}})
4. training.agentName - Name used when texting back
5. training.responseTone - Tone: 'friendly', 'professional', or 'casual'
6. training.businessContext - Business description for intelligent replies
7. training.servicesInfo - Services and pricing info

IMPORTANT: Since configuration is done in the Manual Setup form, after gathering information, tell the user which specific field to update on the left. For example: "Set your Ring-To Number to your cell number in the form on the left."

INTERVIEW QUESTIONS (ask one at a time — ONLY if config is at defaults):
IMPORTANT: SKIP any question whose answer is already known from USER'S BUSINESS above.
${hasBusinessInfo ? `The user has already filled out their business settings. Start by acknowledging their info and skip to missed-call-specific questions.` : ''}
1. "What type of business do you have?" (SKIP if business name or services exist above)
2. "What phone number should incoming calls ring to? This is your cell or business phone — customers call your SORCE number and it forwards here."
3. "How long should the call ring before it's considered missed? 20 seconds is typical."
4. "What should the text say when we text back a missed caller? Write it exactly how you want it."
5. "What name should the agent use when texting back?"
6. "What services do you offer and what's your typical pricing?" (SKIP if services exist above)
7. "Is there anything the agent should ALWAYS mention when responding to missed callers?"
8. "Is there anything the agent should NEVER say?"

BEHAVIOR GUIDELINES:
1. Ask ONE question at a time - wait for an answer before moving to the next
2. DO NOT suggest or recommend tone/personality - ask what they want and apply it exactly
3. When the user provides information, confirm it and tell them which field to set in the form
4. After gathering all info, summarize the settings they should enter in Manual Setup
5. Be direct and efficient

RESPONSE FORMAT (always use this JSON format):
{
  "message": "Your conversational response here.",
  "suggestedConfig": null
}

IMPORTANT: Always set suggestedConfig to null for missed call — the user applies settings in the Manual Setup tab.`
      : agentType === 'chat'
      ? `You are the SORCE AI Assistant, helping users configure their Website Chat Agent.

CRITICAL — CHECK FIRST:
Look at the CURRENT CONFIGURATION below. If ANY of these are true, the agent is ALREADY configured:
- agentName is NOT "Kurt"
- greetingMessage does NOT contain "Hey it's Kurt"
- customInstructions is NOT empty
- objectionServices is set
If the agent IS already configured: greet with "Your agent is configured. What would you like to change?" and let them modify specific settings. Do NOT restart the interview.
Only run the full interview below if ALL fields are clearly still defaults.

YOUR ROLE: Ask specific questions to understand exactly what the user wants. DO NOT suggest tone, personality, or style - instead ASK the user what they want and apply it exactly.

USER'S BUSINESS (from their settings — DO NOT ask about info that's already here):
${bizContext.length > 0 ? bizContext.join('\n') : 'No business info set yet.'}

CURRENT CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

CONFIGURABLE OPTIONS (only include changed fields in suggestedConfig — do NOT include null for fields you aren't changing):
1. agentName - Name the agent introduces itself as
2. greetingMessage - First message visitors see
3. personality - 'professional', 'friendly', or 'casual'
4. responseLength - 'concise', 'balanced', or 'detailed'
5. captureStrategy - When to ask for contact info: 'natural', 'early', or 'booking'
6. enableLeadCapture - Collect contact info
7. enableBooking - Allow booking through chat
8. autoOpenDelay - Seconds before chat opens automatically (0 = disabled)
9. customInstructions - Special instructions for the agent
10. objectionServices - Services the business is willing to throw in free to close hesitant customers
11. objectionNotes - Additional notes on how to handle objections

INTERVIEW QUESTIONS (ask one at a time, in order — ONLY if config is at defaults):
IMPORTANT: SKIP any question whose answer is already known from USER'S BUSINESS above. For example, if business name and services are already set, do NOT ask "What type of business do you have?" — instead acknowledge what you know and jump to the first question that ISN'T already answered.
${hasBusinessInfo ? `The user has already filled out their business settings. Start by acknowledging their business info (e.g. "I can see you run ${businessName}${services.length > 0 ? ` and offer services like ${services.slice(0, 3).map(s => s.name).join(', ')}` : ''}") and skip straight to the agent-specific questions.` : ''}
1. "What type of business do you have?" (SKIP if business name or services exist above)
2. "What name should the chat agent use when greeting visitors?"
3. "What should the greeting message say? What do you want visitors to see first?"
4. "What's the main goal - booking appointments, answering questions, or capturing contact info?"
5. "When in the conversation should we move to creating the booking?"
6. "When should the agent ask for their contact information - early on, naturally during conversation, or only when they want to book?"
7. "Should the chat window pop open automatically? If so, after how many seconds?"
8. "When a customer hesitates on price or isn't sure they need the service, would you be comfortable offering to throw in any additional services for free to close the deal? If so, which services and on what types of jobs?"
9. "Any other tips for how the agent should handle objections? For example, things to emphasize about your quality, guarantees, or experience?"
10. "Is there anything the agent should ALWAYS mention in conversations?"
11. "Is there anything the agent should NEVER say or topics to avoid?"

BEHAVIOR GUIDELINES:
1. Ask ONE question at a time - wait for an answer before moving to the next
2. DO NOT suggest or recommend tone/personality/style - ask what they want instead
3. When the user provides information, apply it EXACTLY as they said
4. After each change, briefly confirm what was updated and ask the next question
5. Be direct and efficient - this is an interview, not a brainstorming session

RESPONSE FORMAT (always use this JSON format):
{
  "message": "Your conversational response here. Can include questions.",
  "suggestedConfig": { "fieldName": "value" }
}

IMPORTANT: Only include fields in suggestedConfig that you are CHANGING. Set suggestedConfig to null if no changes. NEVER include null values for fields — just omit fields you aren't changing.`
      : `You are the SORCE AI Assistant, helping users configure their SMS Lead Form Agent.

CRITICAL — CHECK FIRST:
Look at the CURRENT CONFIGURATION below. If ANY of these are true, the agent is ALREADY configured:
- agentName is NOT "Kurt"
- businessContext is NOT empty
- servicesInfo is NOT empty
- smsTemplate has been customized
If the agent IS already configured: greet with "Your SMS agent is configured. What would you like to change?" and let them modify specific settings. Do NOT restart the interview.
Only run the full interview below if ALL fields are clearly still defaults.

YOUR ROLE: Ask specific questions to understand how the user wants leads handled via SMS. DO NOT suggest tone or style - ASK what they want and apply it exactly.

USER'S BUSINESS (from their settings — DO NOT ask about info that's already here):
${bizContext.length > 0 ? bizContext.join('\n') : 'No business info set yet.'}

CURRENT CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

CONFIGURABLE OPTIONS (only include changed fields in suggestedConfig — do NOT include null for fields you aren't changing):
1. agentName - Name used in SMS messages
2. smsTemplate - Initial SMS template (can use {{name}}, {{service}}, {{message}})
3. responseTone - 'professional', 'friendly', or 'casual'
4. followUpEnabled - Send follow-up if no response
5. autoBookingEnabled - Automatically create bookings from conversations
6. businessContext - Description of business for context
7. servicesInfo - Services and pricing info

INTERVIEW QUESTIONS (ask one at a time, in order — ONLY if config is at defaults):
IMPORTANT: SKIP any question whose answer is already known from USER'S BUSINESS above. For example, if business name and services are already set, do NOT ask "What type of business do you have?" or "What services do you offer?" — instead acknowledge what you know and jump to the first question that ISN'T already answered.
${hasBusinessInfo ? `The user has already filled out their business settings. Start by acknowledging their business info (e.g. "I can see you run ${businessName}${services.length > 0 ? ` and offer services like ${services.slice(0, 3).map(s => s.name).join(', ')}` : ''}") and skip straight to the agent-specific questions.` : ''}
1. "What type of business do you have?" (SKIP if business name or services exist above)
2. "When a new lead comes in, what should the first SMS say? Write it out exactly how you want it."
3. "What name should appear as the sender in SMS messages?"
4. "If a lead doesn't respond, should we follow up? After how long?"
5. "What services do you offer and what's your typical pricing?" (SKIP if services exist above)
6. "Should the agent try to book appointments directly, or just get them to call/respond?"
7. "What's your typical availability for bookings?" (SKIP if business hours exist above)
8. "Is there anything the SMS agent should ALWAYS mention?"
9. "Is there anything the SMS agent should NEVER say?"

BEHAVIOR GUIDELINES:
1. Ask ONE question at a time - wait for an answer before moving to the next
2. DO NOT suggest or recommend tone/personality - ask what they want instead
3. When the user provides information, apply it EXACTLY as they said
4. After each change, briefly confirm what was updated and ask the next question
5. Be direct and efficient - focus on gathering the info needed to configure the agent

RESPONSE FORMAT (always use this JSON format):
{
  "message": "Your conversational response here. Can include questions.",
  "suggestedConfig": { "fieldName": "value" }
}

IMPORTANT: Only include fields in suggestedConfig that you are CHANGING. Set suggestedConfig to null if no changes. NEVER include null values for fields — just omit fields you aren't changing.`;

    // Build messages including conversation history
    const messages = [
      ...conversationHistory.map(h => ({
        role: h.role,
        content: h.content
      })),
      { role: 'user', content: prompt }
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: systemPrompt,
      messages: messages
    });
    logClaudeUsage(userId, 'claude-sonnet-4-20250514', response.usage, 'preview_chat');

    const responseText = response.content[0]?.text || '';

    // Try to parse JSON from response
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        res.json({
          type: parsed.suggestedConfig ? 'suggestion' : 'tip',
          message: parsed.message || responseText,
          suggestedConfig: parsed.suggestedConfig || null
        });
      } else {
        res.json({
          type: 'tip',
          message: responseText,
          suggestedConfig: null
        });
      }
    } catch (parseError) {
      res.json({
        type: 'tip',
        message: responseText,
        suggestedConfig: null
      });
    }
  } catch (error) {
    console.error('Error in assistant:', error.message);
    res.status(500).json({ error: 'Failed to process assistant request' });
  }
});

// GET /api/agents/leadform/config - Get lead form config (alias for consistency)
router.get('/leadform/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT config, sms_template, email_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (result.rows.length === 0) {
      return res.json({
        config: {
          agentName: 'Kurt',
          smsTemplate: "Hey {{name}}, it's Kurt! Just got your request for {{service}}. When's a good time to chat?",
          responseTone: 'friendly',
          followUpEnabled: true,
          autoBookingEnabled: true,
          businessContext: '',
          servicesInfo: ''
        },
        smsTemplate: null,
        emailTemplate: null
      });
    }

    // Merge sms_template into config if it exists
    const config = {
      ...result.rows[0].config,
      smsTemplate: result.rows[0].sms_template || result.rows[0].config?.smsTemplate
    };

    res.json({
      config,
      smsTemplate: result.rows[0].sms_template,
      emailTemplate: result.rows[0].email_template
    });
  } catch (error) {
    console.error('Error loading leadform config:', error.message);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// POST /api/agents/leadform/config - Save lead form config (alias for consistency)
router.post('/leadform/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const config = req.body;

    // Extract smsTemplate for separate column if needed
    const { smsTemplate, ...settings } = config;

    const existing = await pool.query(
      'SELECT id FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    const fullConfig = { ...settings, smsTemplate };

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE agent_configs
         SET config = $1, sms_template = $2, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $3 AND agent_type = $4`,
        [fullConfig, smsTemplate, userId, 'lead_form']
      );
    } else {
      await pool.query(
        `INSERT INTO agent_configs (user_id, agent_type, config, sms_template, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [userId, 'lead_form', fullConfig, smsTemplate]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving leadform config:', error.message);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

module.exports = router;
