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

    res.json({ config: result.rows[0].config });
  } catch (error) {
    console.error('Error fetching website agent config:', error);
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
    console.error('Error checking website agent status:', error);
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
    console.error('Error checking lead form agent status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Website Chat Agent - Save config
router.post('/website/config', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      agentName, greetingMessage, autoOpenDelay,
      personality, responseLength, captureStrategy,
      customInstructions, enableBooking, enableLeadCapture
    } = req.body;

    const config = {
      agentName, greetingMessage, autoOpenDelay,
      personality, responseLength, captureStrategy,
      customInstructions, enableBooking, enableLeadCapture,
      enabled: true
    };

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
    console.error('Error saving lead-form training:', error);
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
    console.error('Error loading lead-form training:', error);
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
    console.error('Error loading lead-form stats:', error);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// POST /api/agents/lead-form/deploy
router.post('/lead-form/deploy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { areaCode } = req.body; // Frontend passes user's area code

    // Check if already has a number
    const userCheck = await pool.query(
      'SELECT twilio_phone_number FROM users WHERE id = $1',
      [userId]
    );

    let phoneNumber = userCheck.rows[0]?.twilio_phone_number;

    // Auto-provision phone number if they don't have one
    if (!phoneNumber) {
      try {
        const { purchasePhoneNumber } = require('../utils/twilio');
        const result = await purchasePhoneNumber(areaCode || '206', userId);
        
        // Update user record
        await pool.query(
          'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = $2 WHERE id = $3',
          [result.phoneNumber, result.phoneSid, userId]
        );

        phoneNumber = result.phoneNumber;
        console.log(`✅ Auto-provisioned ${phoneNumber} for user ${userId}`);
      } catch (error) {
        console.error('Error provisioning phone:', error);
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

// ============================================
// PREVIEW & ASSISTANT ENDPOINTS
// ============================================

// POST /api/agents/preview-chat - Test agent responses in preview mode
router.post('/preview-chat', authenticateToken, async (req, res) => {
  try {
    const { message, config, agentType, history = [] } = req.body;
    const userId = req.user.userId;

    if (!message || !config) {
      return res.status(400).json({ error: 'Message and config are required' });
    }

    // Get user's business info for context
    const userResult = await pool.query(
      'SELECT business_name FROM users WHERE id = $1',
      [userId]
    );
    const businessName = userResult.rows[0]?.business_name || 'Our business';

    // Get services for context
    const servicesResult = await pool.query(
      'SELECT name, description, price, duration_hours FROM services WHERE user_id = $1 LIMIT 10',
      [userId]
    );
    const services = servicesResult.rows;

    // Build system prompt based on agent type and config
    let systemPrompt = '';

    if (agentType === 'chat') {
      systemPrompt = `You are ${config.agentName || 'Kurt'}, a helpful AI assistant for ${businessName}.

Personality: ${config.personality || 'friendly'}
Response style: Be ${config.responseLength || 'concise'} in your responses.

${config.customInstructions ? `Additional instructions: ${config.customInstructions}` : ''}

Available services:
${services.map(s => `- ${s.name}: ${s.description || 'No description'} ($${s.price || 'Quote'}, ${s.duration_hours ? s.duration_hours + ' hrs' : '30 min'})`).join('\n') || 'Services are being configured.'}

Your goals:
${config.enableLeadCapture ? '- Naturally gather contact info (name, email, phone) when appropriate' : ''}
${config.enableBooking ? '- Help customers book appointments when they express interest' : ''}
- Answer questions about services professionally
- Keep responses natural and conversational

Lead capture strategy: ${config.captureStrategy === 'early' ? 'Ask for contact info within the first 2-3 messages' : config.captureStrategy === 'booking' ? 'Only ask for contact info when booking' : 'Ask naturally when relevant'}`;
    } else {
      // Lead form agent - SMS style
      systemPrompt = `You are ${config.agentName || 'Kurt'}, responding via SMS for ${businessName}.

Tone: ${config.responseTone || 'friendly'}

Business context: ${config.businessContext || 'Local service business'}
Services info: ${config.servicesInfo || services.map(s => s.name).join(', ') || 'Various services available'}

Keep responses SHORT (under 160 characters ideally for SMS).
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

    const reply = response.content[0]?.text || "I'm here to help! How can I assist you today?";

    res.json({ reply });
  } catch (error) {
    console.error('Error in preview-chat:', error);
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
    const userResult = await pool.query(
      'SELECT business_name FROM users WHERE id = $1',
      [userId]
    );
    const businessName = userResult.rows[0]?.business_name || '';

    // Get services for context
    const servicesResult = await pool.query(
      'SELECT name, description, price FROM services WHERE user_id = $1 LIMIT 10',
      [userId]
    );
    const services = servicesResult.rows;

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic();

    const systemPrompt = agentType === 'chat'
      ? `You are the SORCE AI Assistant, helping users configure their Website Chat Agent through an interview process.

YOUR ROLE: Ask specific questions to understand exactly what the user wants. DO NOT suggest tone, personality, or style - instead ASK the user what they want and apply it exactly.

USER'S BUSINESS:
- Business name: ${businessName || 'Not set'}
- Services: ${services.length > 0 ? services.map(s => s.name).join(', ') : 'Not configured yet'}

CURRENT CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

CONFIGURABLE OPTIONS:
1. agentName - Name the agent introduces itself as
2. greetingMessage - First message visitors see
3. personality - 'professional', 'friendly', or 'casual'
4. responseLength - 'concise', 'balanced', or 'detailed'
5. captureStrategy - When to ask for contact info: 'natural', 'early', or 'booking'
6. enableLeadCapture - Collect contact info
7. enableBooking - Allow booking through chat
8. autoOpenDelay - Seconds before chat opens automatically (0 = disabled)
9. customInstructions - Special instructions for the agent

INTERVIEW QUESTIONS (ask one at a time, in order):
1. "What type of business do you have?" (to understand context)
2. "What name should the chat agent use when greeting visitors?"
3. "What should the greeting message say? What do you want visitors to see first?"
4. "What's the main goal - booking appointments, answering questions, or capturing contact info?"
5. "When in the conversation should we move to creating the booking?"
6. "When should the agent ask for their contact information - early on, naturally during conversation, or only when they want to book?"
7. "Should the chat window pop open automatically? If so, after how many seconds?"
8. "Is there anything the agent should ALWAYS mention in conversations?"
9. "Is there anything the agent should NEVER say or topics to avoid?"

BEHAVIOR GUIDELINES:
1. Ask ONE question at a time - wait for an answer before moving to the next
2. DO NOT suggest or recommend tone/personality/style - ask what they want instead
3. When the user provides information, apply it EXACTLY as they said
4. After each change, briefly confirm what was updated and ask the next question
5. Be direct and efficient - this is an interview, not a brainstorming session

RESPONSE FORMAT (always use this JSON format):
{
  "message": "Your conversational response here. Can include questions.",
  "suggestedConfig": { "fieldName": "value" } // or null if no changes
}

If making multiple changes, include all in suggestedConfig. If just asking questions or chatting, set suggestedConfig to null.`
      : `You are the SORCE AI Assistant, helping users configure their SMS Lead Form Agent through an interview process.

YOUR ROLE: Ask specific questions to understand how the user wants leads handled via SMS. DO NOT suggest tone or style - ASK what they want and apply it exactly.

USER'S BUSINESS:
- Business name: ${businessName || 'Not set'}
- Services: ${services.length > 0 ? services.map(s => s.name).join(', ') : 'Not configured yet'}

CURRENT CONFIGURATION:
${JSON.stringify(currentConfig, null, 2)}

CONFIGURABLE OPTIONS:
1. agentName - Name used in SMS messages
2. smsTemplate - Initial SMS template (can use {{name}}, {{service}}, {{message}})
3. responseTone - 'professional', 'friendly', or 'casual'
4. followUpEnabled - Send follow-up if no response
5. autoBookingEnabled - Automatically create bookings from conversations
6. businessContext - Description of business for context
7. servicesInfo - Services and pricing info

INTERVIEW QUESTIONS (ask one at a time, in order):
1. "What type of business do you have?" (to understand context)
2. "When a new lead comes in, what should the first SMS say? Write it out exactly how you want it."
3. "What name should appear as the sender in SMS messages?"
4. "If a lead doesn't respond, should we follow up? After how long?"
5. "What services do you offer and what's your typical pricing?"
6. "Should the agent try to book appointments directly, or just get them to call/respond?"
7. "What's your typical availability for bookings?"
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
  "suggestedConfig": { "fieldName": "value" } // or null if no changes
}

If making multiple changes, include all in suggestedConfig. If just asking questions or chatting, set suggestedConfig to null.`;

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
    console.error('Error in assistant:', error);
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
    console.error('Error loading leadform config:', error);
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
    console.error('Error saving leadform config:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

module.exports = router;
