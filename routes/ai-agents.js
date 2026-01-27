const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requirePlan } = require('../config/middleware');

// Website Chat Agent - Get config
router.get('/website/config', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    if (result.rows.length === 0) {
      return res.json({
        config: {
          enabled: true,
          agentName: 'Kurt',
          greetingMessage: "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?",
          autoOpenDelay: 3
        }
      });
    }

    res.json({ config: result.rows[0].config });
  } catch (error) {
    console.error('Error fetching website agent config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Website Chat Agent - Save config
router.post('/website/config', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { agentName, greetingMessage, autoOpenDelay } = req.body;

    const config = { agentName, greetingMessage, autoOpenDelay, enabled: true };

    const result = await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
       ON CONFLICT (user_id, agent_type) 
       DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP 
       RETURNING *`,
      [userId, 'website_chat', JSON.stringify(config)]
    );

    res.json({ success: true, config: result.rows[0].config });
  } catch (error) {
    console.error('Error saving website agent config:', error);
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
    console.error('Error fetching website agent stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
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
      autoOpenDelay: 3
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
    console.error('Error toggling website agent:', error);
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
      autoOpenDelay: 3
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
    const websiteModule = require('./website');
    const generateChatWidgetCode = websiteModule.generateChatWidgetCode || websiteModule;
    const websiteColors = {
  primaryColor: website.primary_color || '#667eea',
  accentColor: website.accent_color || '#764ba2', 
  textColor: website.text_color || '#1f2937'
};
const chatWidgetCode = generateChatWidgetCode(userId, config, websiteColors);
    console.log('🔧 Generated chat widget code');

    // 4. Inject widget into all pages
    let pagesUpdated = [];
    
    if (pages && Object.keys(pages).length > 0) {
      Object.keys(pages).forEach(pageKey => {
        if (pages[pageKey].includes('</body>') && !pages[pageKey].includes('sorce-chat-widget')) {
          pages[pageKey] = pages[pageKey].replace('</body>', chatWidgetCode + '\n</body>');
          pagesUpdated.push(pageKey);
          console.log(`✅ Injected widget into ${pageKey}`);
        } else if (pages[pageKey].includes('sorce-chat-widget')) {
          console.log(`ℹ️ Widget already exists in ${pageKey}`);
        }
      });
    }

    if (htmlContent && htmlContent.includes('</body>') && !htmlContent.includes('sorce-chat-widget')) {
      htmlContent = htmlContent.replace('</body>', chatWidgetCode + '\n</body>');
      pagesUpdated.push('index.html');
      console.log('✅ Injected widget into main html_content');
    } else if (htmlContent && htmlContent.includes('sorce-chat-widget')) {
      console.log('ℹ️ Widget already exists in main html_content');
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
    console.error('Error deploying website agent:', error);
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
    console.error('Error loading lead-form config:', error);
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
    console.error('Error saving lead-form config:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
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
    console.error('Error loading lead-form stats:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// POST /api/agents/lead-form/deploy
router.post('/lead-form/deploy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

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
    res.json({ success: true, message: 'Lead form agent deployed successfully' });
  } catch (error) {
    console.error('Error deploying lead form agent:', error);
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
    console.error('Error checking lead form agent status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

module.exports = router;
