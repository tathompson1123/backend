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

// Lead Form Agent - Get templates
router.get('/leadform/templates', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT email_template, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    if (result.rows.length === 0) {
      const defaultEmail = "Hey {{name}},\n\nThanks for reaching out!...";
      const defaultSms = "Hey {{name}}, it's Kurt! Just got your request for {{service}}. When's a good time to chat? - Kurt";
      
      return res.json({ email: defaultEmail, sms: defaultSms });
    }

    res.json({
      email: result.rows[0].email_template,
      sms: result.rows[0].sms_template
    });
  } catch (error) {
    console.error('Error fetching lead form templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Lead Form Agent - Save templates
router.post('/leadform/deploy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Check if config exists
    const existing = await pool.query(
      'SELECT * FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    const defaultSmsTemplate = `Hi {{name}}! Thanks for reaching out to Thompsons Auto Detailing. We received your inquiry about {{service}} and will get back to you within 24 hours. Reply STOP to opt out.`;

    const defaultEmailTemplate = `Hi {{name}},

Thank you for contacting Thompsons Auto Detailing! We received your message about {{service}}.

We'll review your request and get back to you within 24 hours.

Best regards,
Thompsons Auto Detailing
{{phone}}
{{email}}`;

    if (existing.rows.length > 0) {
      // Update existing - enable it and set templates if they're null
      const currentConfig = existing.rows[0].config || {};
      const currentSmsTemplate = existing.rows[0].sms_template;
      const currentEmailTemplate = existing.rows[0].email_template;

      await pool.query(
        `UPDATE agent_configs 
         SET config = $1, 
             sms_template = COALESCE($2, sms_template, $3),
             email_template = COALESCE($4, email_template, $5),
             updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = $6 AND agent_type = $7`,
        [
          { ...currentConfig, enabled: true, smsEnabled: true, emailEnabled: true },
          currentSmsTemplate,
          defaultSmsTemplate,
          currentEmailTemplate,
          defaultEmailTemplate,
          userId,
          'lead_form'
        ]
      );
    } else {
      // Create new with defaults
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
// Lead Form Agent - Get stats
router.get('/leadform/stats', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);

    const totalResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND created_at >= $3',
      [userId, 'lead_form', startOfMonth]
    );

    const emailsResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND status = $3 AND created_at >= $4',
      [userId, 'lead_form', 'contacted_email', startOfMonth]
    );

    const smsResult = await pool.query(
      'SELECT COUNT(*) as count FROM leads WHERE user_id = $1 AND source = $2 AND status = $3 AND created_at >= $4',
      [userId, 'lead_form', 'contacted_sms', startOfMonth]
    );

    const total = parseInt(totalResult.rows[0].count);
    const emailsSent = parseInt(emailsResult.rows[0].count);
    const smsSent = parseInt(smsResult.rows[0].count);

    res.json({
      total,
      emailsSent,
      smsSent,
      responseRate: total > 0 ? Math.round((emailsSent + smsSent) / total * 100) : 0
    });
  } catch (error) {
    console.error('Error fetching lead form stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Lead Form Agent - Toggle
router.patch('/leadform', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enabled } = req.body;

    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    let config = { enabled };

    if (existing.rows.length > 0 && existing.rows[0].config) {
      config = { ...existing.rows[0].config, enabled };
    }

    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
       ON CONFLICT (user_id, agent_type) 
       DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP`,
      [userId, 'lead_form', JSON.stringify(config)]
    );

    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Error toggling lead form agent:', error);
    res.status(500).json({ error: 'Failed to toggle agent' });
  }
});

// Add these two routes to your agents.js file

// Website Chat Agent - Deploy
router.post('/website/deploy', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get existing config or use defaults
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

    res.json({ success: true, message: 'Website chat agent deployed successfully' });
  } catch (error) {
    console.error('Error deploying website agent:', error);
    res.status(500).json({ error: 'Failed to deploy agent' });
  }
});

// Lead Form Agent - Deploy
router.post('/leadform/deploy', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get existing config or use defaults
    const existing = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'lead_form']
    );

    let config = { enabled: true };

    if (existing.rows.length > 0 && existing.rows[0].config) {
      config = { ...existing.rows[0].config, enabled: true };
    }

    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, created_at, updated_at) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
       ON CONFLICT (user_id, agent_type) 
       DO UPDATE SET config = $3, updated_at = CURRENT_TIMESTAMP`,
      [userId, 'lead_form', JSON.stringify(config)]
    );

    res.json({ success: true, message: 'Lead form agent deployed successfully' });
  } catch (error) {
    console.error('Error deploying lead form agent:', error);
    res.status(500).json({ error: 'Failed to deploy agent' });
  }
});

// Website Chat Agent - Get deployment status
router.get('/website/status', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [userId, 'website_chat']
    );

    const isDeployed = result.rows.length > 0 && result.rows[0].config?.enabled === true;
    res.json({ isDeployed });
  } catch (error) {
    console.error('Error checking website agent status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Lead Form Agent - Get deployment status
router.get('/leadform/status', authenticateToken, requirePlan('pro'), async (req, res) => {
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
