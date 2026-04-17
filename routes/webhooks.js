const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { triggerLeadFormAgent } = require('./leads');

async function getUserBySiteKey(siteKey) {
  const result = await pool.query('SELECT id FROM users WHERE site_key = $1', [siteKey]);
  return result.rows[0] || null;
}

/**
 * POST /api/webhooks/form/:siteKey
 * Accepts form submission data from external platforms (Wix, Squarespace, WordPress, Zapier).
 * Creates a lead and triggers the SMS lead agent — fully reliable alternative to embed form intercept.
 *
 * Body: { name, email, phone, service, message, platform, page_url }
 * At least one of name/email/phone is required.
 */
router.post('/form/:siteKey', async (req, res) => {
  try {
    const { siteKey } = req.params;
    const { name, email, phone, service, message, platform, page_url } = req.body;

    // Resolve userId from siteKey
    const user = await getUserBySiteKey(siteKey);
    if (!user) {
      return res.status(404).json({ error: 'Invalid site key' });
    }
    const userId = user.id;

    // Require at least one contact field
    if (!name && !email && !phone) {
      return res.status(400).json({ error: 'At least one of name, email, or phone is required' });
    }

    // Duplicate check: same email+phone submitted within 5 minutes
    if (email || phone) {
      const dup = await pool.query(
        `SELECT id FROM leads
         WHERE user_id = $1
           AND (email = $2 OR phone = $3)
           AND created_at > NOW() - INTERVAL '5 minutes'`,
        [userId, email || '', phone || '']
      );
      if (dup.rows.length > 0) {
        return res.json({ success: true, duplicate: true, message: 'Lead already submitted recently' });
      }
    }

    // Insert lead — source must be 'lead_form' to trigger SMS agent
    const result = await pool.query(
      `INSERT INTO leads (user_id, name, email, phone, status, source, service, message, sms_consent, created_at)
       VALUES ($1, $2, $3, $4, 'new', 'lead_form', $5, $6, true, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        userId,
        name || '',
        email || '',
        phone || '',
        service || (platform ? `via ${platform}` : ''),
        message || (page_url ? `Submitted from: ${page_url}` : '')
      ]
    );

    const newLead = result.rows[0];
    console.log(`📨 Webhook lead: ${name || email || phone} via ${platform || 'external'} → user ${userId}`);

    // Trigger SMS lead agent (non-blocking)
    triggerLeadFormAgent(userId, newLead).catch(err =>
      console.error('Webhook: triggerLeadFormAgent error:', err.message)
    );

    res.json({ success: true, leadId: newLead.id });
  } catch (error) {
    console.error('Webhook form error:', error.message);
    res.status(500).json({ error: 'Failed to process form submission' });
  }
});

/**
 * POST /api/webhooks/google-lsa/:userId
 * Google Local Services Ads webhook — fires when a new lead comes in.
 * Configure this URL in your Google LSA dashboard under "Lead Notification".
 *
 * Google sends a JSON body with lead details. We normalise it and create a lead.
 */
router.post('/google-lsa/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const body = req.body;

    // Verify user exists
    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userRes.rows[0]) return res.status(404).json({ error: 'User not found' });

    // Google LSA lead payload varies — normalise common fields
    const customerName = body.customer_name || body.advertiser_name
      || [body.first_name, body.last_name].filter(Boolean).join(' ')
      || 'Google LSA Lead';
    const customerPhone = body.customer_phone_number || body.phone_number || body.phone || null;
    const customerEmail = body.customer_email || body.email || null;
    const jobType = body.job_type || body.category || body.service_type || body.lead_type || null;
    const notes = body.note || body.message || body.details || null;
    const googleLsaLeadId = body.lead_id || body.google_key || body.id || null;

    // Avoid duplicates by google_lsa_lead_id
    if (googleLsaLeadId) {
      const existing = await pool.query(
        'SELECT id FROM leads WHERE user_id = $1 AND google_lsa_lead_id = $2',
        [userId, googleLsaLeadId]
      );
      if (existing.rows.length > 0) {
        return res.json({ success: true, duplicate: true, leadId: existing.rows[0].id });
      }
    }

    const result = await pool.query(`
      INSERT INTO leads (user_id, name, phone, email, source, status, service, message, google_lsa_lead_id, created_at)
      VALUES ($1, $2, $3, $4, 'google_lsa', 'new', $5, $6, $7, NOW())
      RETURNING *
    `, [userId, customerName, customerPhone, customerEmail, jobType, notes, googleLsaLeadId]);

    const newLead = result.rows[0];
    console.log(`📍 Google LSA lead: ${customerName} (${customerPhone}) → user ${userId}`);

    // Trigger SMS lead agent
    const { triggerLeadFormAgent } = require('./leads');
    triggerLeadFormAgent(userId, newLead).catch(err =>
      console.error('LSA: triggerLeadFormAgent error:', err.message)
    );

    res.json({ success: true, leadId: newLead.id });
  } catch (error) {
    console.error('Google LSA webhook error:', error.message);
    res.status(500).json({ error: 'Failed to process LSA lead' });
  }
});

/**
 * POST /api/webhooks/call-recording/:userId
 * Twilio / Telnyx call recording webhook.
 * Configure as the "Recording Status Callback" in Twilio or Telnyx.
 *
 * Twilio body: RecordingUrl, CallSid, From, To, RecordingDuration
 * Telnyx body: data.payload.recording_urls.mp3, data.payload.from, data.payload.call_duration_secs
 *
 * Flow: download recording → transcribe via OpenAI Whisper → Claude extracts lead info → save lead
 */
router.post('/call-recording/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const body = req.body;

    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!userRes.rows[0]) return res.status(404).json({ error: 'User not found' });

    // Normalise Twilio vs Telnyx payloads
    const isTelnyx = body.data?.event_type?.includes('call');
    const recordingUrl = isTelnyx
      ? body.data?.payload?.recording_urls?.mp3
      : body.RecordingUrl ? `${body.RecordingUrl}.mp3` : null;
    const callerPhone = isTelnyx ? body.data?.payload?.from : body.From;
    const callSid = isTelnyx ? body.data?.payload?.call_control_id : body.CallSid;
    const durationSecs = parseInt(
      isTelnyx ? body.data?.payload?.call_duration_secs : body.RecordingDuration
    ) || 0;

    if (!recordingUrl) {
      return res.json({ success: false, reason: 'No recording URL in payload' });
    }

    // Respond immediately — process async
    res.json({ success: true, processing: true });

    setImmediate(async () => {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const axios = require('axios');
        const FormData = require('form-data');
        const OpenAI = require('openai');

        // Download recording
        const audioRes = await axios.get(recordingUrl, {
          responseType: 'arraybuffer',
          auth: recordingUrl.includes('twilio') && process.env.TWILIO_ACCOUNT_SID
            ? { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN }
            : undefined,
        });

        // Transcribe with OpenAI Whisper
        let transcript = '';
        if (process.env.OPENAI_API_KEY) {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const form = new FormData();
          form.append('file', Buffer.from(audioRes.data), { filename: 'call.mp3', contentType: 'audio/mpeg' });
          form.append('model', 'whisper-1');
          const whisperRes = await openai.audio.transcriptions.create({
            file: new File([Buffer.from(audioRes.data)], 'call.mp3', { type: 'audio/mpeg' }),
            model: 'whisper-1',
          });
          transcript = whisperRes.text || '';
        }

        if (!transcript) {
          // Save lead with call info but no transcript
          await pool.query(`
            INSERT INTO leads (user_id, name, phone, source, status, call_recording_url, call_duration, created_at)
            VALUES ($1, 'Inbound Call', $2, 'inbound_call', 'new', $3, $4, NOW())
            ON CONFLICT DO NOTHING
          `, [userId, callerPhone, recordingUrl, durationSecs]);
          return;
        }

        // Extract lead info from transcript using Claude
        const extractRes = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Extract customer lead information from this phone call transcript. Return ONLY valid JSON with these fields (use null if not mentioned):
{"name": string|null, "email": string|null, "phone": string|null, "service": string|null, "message": string|null}

Transcript:
${transcript.slice(0, 2000)}`
          }]
        });

        let extracted = {};
        try {
          const jsonMatch = extractRes.content[0].text.match(/\{[\s\S]*\}/);
          if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
        } catch { extracted = {}; }

        await pool.query(`
          INSERT INTO leads (user_id, name, phone, email, source, status, service, message,
            call_recording_url, call_transcript, call_duration, created_at)
          VALUES ($1, $2, $3, $4, 'inbound_call', 'new', $5, $6, $7, $8, $9, NOW())
        `, [
          userId,
          extracted.name || 'Inbound Call',
          extracted.phone || callerPhone,
          extracted.email || null,
          extracted.service || null,
          extracted.message || transcript.slice(0, 500),
          recordingUrl,
          transcript,
          durationSecs,
        ]);

        console.log(`📞 Call recording processed: ${extracted.name || callerPhone} → user ${userId}`);
      } catch (err) {
        console.error('Call recording processing error:', err.message);
      }
    });
  } catch (error) {
    console.error('Call recording webhook error:', error.message);
    res.status(500).json({ error: 'Failed to process call recording' });
  }
});

module.exports = router;
