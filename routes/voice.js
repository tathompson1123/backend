const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requirePlan } = require('../config/middleware');
const { setVoiceWebhook } = require('../utils/twilio');

const BACKEND_URL = process.env.BACKEND_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3001');

// ============================================
// POST /webhook — Twilio voice webhook (public, returns TwiML)
// ============================================
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  const hangupXml = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
  try {
    const { From, To, CallSid } = req.body;
    console.log(`📞 Incoming call: ${From} → ${To} (CallSid: ${CallSid})`);

    // Look up user by their SMS Agent Number
    const userResult = await pool.query(
      'SELECT id, business_name FROM users WHERE twilio_phone_number = $1',
      [To]
    );

    if (userResult.rows.length === 0) {
      console.log(`⚠️ No user found for ${To}`);
      res.type('text/xml');
      return res.send(hangupXml);
    }

    const user = userResult.rows[0];
    const configResult = await pool.query(
      'SELECT config FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [user.id, 'missed_call']
    );

    const config = configResult.rows[0]?.config;

    if (!config?.enabled) {
      console.log(`⚠️ Missed call agent not enabled for user ${user.id}`);
      res.type('text/xml');
      return res.send(hangupXml);
    }

    const ringToNumber = config?.ringToNumber;
    if (!ringToNumber) {
      // No ring-to number configured — hang up and treat as missed immediately
      console.log(`⚠️ No ringToNumber set for user ${user.id}, hanging up`);
      res.type('text/xml');
      return res.send(hangupXml);
    }

    // Ring through to the business owner's phone.
    // The /status callback fires when the call ends and handles missed vs. answered.
    const ringTimeout = config?.ringTimeout || 20;
    const statusUrl = `${BACKEND_URL}/api/voice/status`;
    console.log(`📲 Ringing ${ringToNumber} for user ${user.id} (timeout: ${ringTimeout}s)`);

    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${statusUrl}" timeout="${ringTimeout}" answerOnBridge="true">
    <Number>${ringToNumber}</Number>
  </Dial>
</Response>`);
  } catch (err) {
    console.error('❌ Voice webhook error:', err.message);
    res.type('text/xml');
    res.send(hangupXml);
  }
});

// ============================================
// POST /status — Twilio dial action callback (public, returns TwiML)
// ============================================
router.post('/status', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { CallSid, From, To, DialCallStatus, DialCallDuration } = req.body;
    console.log(`📞 Call status: ${From} → ${To} | DialCallStatus: ${DialCallStatus}`);

    // Find user by their Twilio phone number
    const userResult = await pool.query(
      'SELECT id, business_name FROM users WHERE twilio_phone_number = $1',
      [To]
    );

    if (userResult.rows.length === 0) {
      res.type('text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    }

    const user = userResult.rows[0];

    // Get agent config for forwarding number
    const configResult = await pool.query(
      'SELECT config, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [user.id, 'missed_call']
    );
    const config = configResult.rows[0]?.config;
    const forwardedTo = config?.forwardingNumber || null;

    if (DialCallStatus === 'completed') {
      // Call was answered — log it and done
      await pool.query(
        `INSERT INTO missed_calls (user_id, caller_phone, called_number, call_sid, call_status, call_duration, forwarded_to, created_at)
         VALUES ($1, $2, $3, $4, 'answered', $5, $6, NOW())`,
        [user.id, From, To, CallSid, parseInt(DialCallDuration) || 0, forwardedTo]
      );
      console.log(`✅ Call answered: ${From} → ${To}`);
      res.type('text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    }

    // Call was missed (no-answer, busy, failed, canceled)
    console.log(`📵 Missed call: ${From} → ${To} (${DialCallStatus})`);

    // Find or create lead from caller phone
    let leadResult = await pool.query(
      'SELECT id, name, email FROM leads WHERE phone = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [From, user.id]
    );

    let leadId;
    if (leadResult.rows.length === 0) {
      const newLead = await pool.query(
        `INSERT INTO leads (user_id, name, phone, source, status, sms_consent, created_at)
         VALUES ($1, $2, $3, 'missed_call', 'new', true, NOW())
         RETURNING id, name, email`,
        [user.id, From, From]
      );
      leadId = newLead.rows[0].id;
      console.log(`📝 New lead ${leadId} from missed call ${From}`);
    } else {
      leadId = leadResult.rows[0].id;
    }

    // Insert missed call record
    const missedCallResult = await pool.query(
      `INSERT INTO missed_calls (user_id, caller_phone, called_number, call_sid, call_status, call_duration, forwarded_to, lead_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id`,
      [user.id, From, To, CallSid, DialCallStatus, parseInt(DialCallDuration) || 0, forwardedTo, leadId]
    );

    // Schedule text-back SMS (same pattern as triggerLeadFormAgent)
    if (config?.smsEnabled && configResult.rows[0]?.sms_template) {
      const minDelay = config.delayMin || 30;
      const maxDelay = config.delayMax || 60;
      const delaySeconds = minDelay + Math.floor(Math.random() * (maxDelay - minDelay));

      await pool.query(
        `UPDATE leads
           SET status = 'sms_pending',
               sms_scheduled_at = NOW() + ($1 * INTERVAL '1 second')
         WHERE id = $2`,
        [delaySeconds, leadId]
      );

      console.log(`⏰ Missed call text-back scheduled for lead ${leadId} in ${delaySeconds}s`);
    }

    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Sorry we missed your call! We'll send you a text message shortly.</Say>
  <Hangup/>
</Response>`);
  } catch (err) {
    console.error('❌ Voice status callback error:', err.message);
    res.type('text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }
});

// ============================================
// GET /config — Get missed call agent config (protected)
// ============================================
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT config, sms_template FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [req.user.userId, 'missed_call']
    );

    if (result.rows.length === 0) {
      return res.json({
        config: {
          enabled: false,
          smsEnabled: true,
          ringToNumber: '',
          ringTimeout: 20,
          delayMin: 30,
          delayMax: 60,
          training: {
            responseTone: 'friendly',
            agentName: '',
            businessContext: '',
            servicesInfo: ''
          }
        },
        smsTemplate: "Hey {{name}}, sorry we missed your call! How can we help you? Reply here and we'll get right back to you."
      });
    }

    res.json({
      config: result.rows[0].config,
      smsTemplate: result.rows[0].sms_template
    });
  } catch (err) {
    console.error('Error fetching voice config:', err.message);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ============================================
// POST /config — Save missed call agent config (protected)
// ============================================
router.post('/config', authenticateToken, async (req, res) => {
  try {
    const { config, smsTemplate } = req.body;

    // Whitelist config fields
    const allowedFields = ['enabled', 'smsEnabled', 'ringToNumber', 'ringTimeout', 'delayMin', 'delayMax', 'training'];
    const safeConfig = {};
    for (const key of allowedFields) {
      if (config[key] !== undefined) safeConfig[key] = config[key];
    }

    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, sms_template, updated_at)
       VALUES ($1, 'missed_call', $2, $3, NOW())
       ON CONFLICT (user_id, agent_type)
       DO UPDATE SET config = $2, sms_template = $3, updated_at = NOW()`,
      [req.user.userId, safeConfig, smsTemplate || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving voice config:', err.message);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// ============================================
// POST /deploy — Deploy missed call text-back (protected, Pro+)
// ============================================
router.post('/deploy', authenticateToken, requirePlan('pro'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { ringToNumber, ringTimeout, smsTemplate, training } = req.body;

    if (!ringToNumber) {
      return res.status(400).json({ error: 'Your phone number (where calls ring to) is required.' });
    }

    // Get user's phone numbers
    const userResult = await pool.query(
      'SELECT twilio_phone_number, twilio_phone_sid FROM users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    const phoneNumber = user?.twilio_phone_number;
    if (!phoneNumber) {
      return res.status(400).json({
        error: 'No phone number provisioned. Deploy the Lead Form Agent first to get a phone number.'
      });
    }

    const hasTwilio = !!(user.twilio_phone_number && user.twilio_phone_sid);

    // Build config
    const config = {
      enabled: true,
      smsEnabled: true,
      ringToNumber,
      ringTimeout: ringTimeout || 20,
      delayMin: req.body.delayMin || 30,
      delayMax: req.body.delayMax || 60,
      training: training || {
        responseTone: 'friendly',
        agentName: '',
        businessContext: '',
        servicesInfo: ''
      }
    };

    const defaultTemplate = "Hey {{name}}, sorry we missed your call! How can we help you? Reply here and we'll get right back to you.";

    // Upsert agent config
    await pool.query(
      `INSERT INTO agent_configs (user_id, agent_type, config, sms_template, enabled, updated_at)
       VALUES ($1, 'missed_call', $2, COALESCE($3, $4), true, NOW())
       ON CONFLICT (user_id, agent_type)
       DO UPDATE SET config = $2, sms_template = COALESCE($3, agent_configs.sms_template, $4), enabled = true, updated_at = NOW()`,
      [userId, config, smsTemplate || null, defaultTemplate]
    );

    // Set voice webhook on the Twilio number if available
    let voiceWebhookUrl = null;
    if (hasTwilio) {
      voiceWebhookUrl = `${BACKEND_URL}/api/voice/webhook`;
      await setVoiceWebhook(user.twilio_phone_sid, voiceWebhookUrl);
      console.log(`✅ Missed call text-back deployed with call forwarding for user ${userId}`);
    } else {
      console.log(`✅ Missed call text-back deployed (SMS only, no call forwarding) for user ${userId}`);
    }

    res.json({
      success: true,
      message: hasTwilio
        ? 'Missed call text-back is now active with call forwarding'
        : 'Missed call text-back is now active (SMS text-back enabled). Call forwarding requires a provisioned Twilio number.',
      phoneNumber,
      callForwarding: hasTwilio,
      webhookUrl: voiceWebhookUrl
    });
  } catch (err) {
    console.error('Error deploying voice agent:', err.message);
    res.status(500).json({ error: 'Failed to deploy missed call text-back' });
  }
});

// ============================================
// GET /missed-calls — Paginated missed calls log (protected)
// ============================================
router.get('/missed-calls', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [callsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT mc.*, l.name AS lead_name, l.email AS lead_email
         FROM missed_calls mc
         LEFT JOIN leads l ON l.id = mc.lead_id
         WHERE mc.user_id = $1
         ORDER BY mc.created_at DESC
         LIMIT $2 OFFSET $3`,
        [req.user.userId, limit, offset]
      ),
      pool.query(
        'SELECT COUNT(*) FROM missed_calls WHERE user_id = $1',
        [req.user.userId]
      )
    ]);

    res.json({
      missedCalls: callsResult.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      limit
    });
  } catch (err) {
    console.error('Error fetching missed calls:', err.message);
    res.status(500).json({ error: 'Failed to fetch missed calls' });
  }
});

// ============================================
// GET /stats — Monthly stats (protected)
// ============================================
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [totalCalls, missedCalls, textsSent, replies] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FROM missed_calls WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM missed_calls WHERE user_id = $1 AND call_status != 'answered' AND created_at >= date_trunc('month', NOW())`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM missed_calls WHERE user_id = $1 AND textback_sent = true AND created_at >= date_trunc('month', NOW())`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) FROM leads WHERE user_id = $1 AND source = 'missed_call' AND status = 'replied' AND created_at >= date_trunc('month', NOW())`,
        [userId]
      )
    ]);

    res.json({
      totalCalls: parseInt(totalCalls.rows[0].count),
      missedCalls: parseInt(missedCalls.rows[0].count),
      textsSent: parseInt(textsSent.rows[0].count),
      replies: parseInt(replies.rows[0].count)
    });
  } catch (err) {
    console.error('Error fetching voice stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ============================================
// GET /status — Check if deployed (protected)
// ============================================
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT config, enabled FROM agent_configs WHERE user_id = $1 AND agent_type = $2',
      [req.user.userId, 'missed_call']
    );

    const isDeployed = result.rows.length > 0 && result.rows[0].enabled && result.rows[0].config?.enabled;

    res.json({ deployed: isDeployed });
  } catch (err) {
    console.error('Error checking voice status:', err.message);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ============================================
// POST /undeploy — Disable missed call agent (protected)
// ============================================
router.post('/undeploy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await pool.query(
      `UPDATE agent_configs
       SET config = jsonb_set(config, '{enabled}', 'false'::jsonb), enabled = false, updated_at = NOW()
       WHERE user_id = $1 AND agent_type = 'missed_call'`,
      [userId]
    );
    console.log(`✅ Missed call agent disabled for user ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error undeploying voice agent:', err.message);
    res.status(500).json({ error: 'Failed to disable agent' });
  }
});

// ============================================
// POST /fix-webhook — Set voice webhook on existing number (protected)
// Fixes numbers purchased before voice webhook was added at purchase time
// ============================================
router.post('/fix-webhook', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userResult = await pool.query(
      'SELECT twilio_phone_number, twilio_phone_sid FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];
    if (!user?.twilio_phone_sid) {
      return res.status(400).json({ error: 'No Twilio number found for this account' });
    }
    const voiceWebhookUrl = `${BACKEND_URL}/api/voice/webhook`;
    await setVoiceWebhook(user.twilio_phone_sid, voiceWebhookUrl);
    res.json({ success: true, number: user.twilio_phone_number, webhookUrl: voiceWebhookUrl });
  } catch (err) {
    console.error('Error fixing voice webhook:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
