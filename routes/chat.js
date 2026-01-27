const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Start a new conversation
router.post('/start', async (req, res) => {
  try {
    const { userId, source } = req.body;

    const result = await pool.query(
      `INSERT INTO chat_conversations (user_id, source, created_at, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [userId, source || 'website']
    );

    res.json({ conversationId: result.rows[0].id });
  } catch (error) {
    console.error('Error starting conversation:', error);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// Send a message
router.post('/message', async (req, res) => {
  try {
    const { userId, conversationId, message } = req.body;

    // Save user message
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'user', $2, CURRENT_TIMESTAMP)`,
      [conversationId, message]
    );

    // Get conversation history
    const historyResult = await pool.query(
      `SELECT role, content FROM chat_messages 
       WHERE conversation_id = $1 
       ORDER BY created_at ASC`,
      [conversationId]
    );

    // Get user's business info
    const userInfoResult = await pool.query(
      `SELECT u.business_name, u.phone, u.email,
              bi.address, bi.city, bi.state
       FROM users u
       LEFT JOIN business_information bi ON u.id = bi.user_id
       WHERE u.id = $1`,
      [userId]
    );

    const userInfo = userInfoResult.rows[0] || {};

    // Get services
    const servicesResult = await pool.query(
      'SELECT name, description, price FROM services WHERE user_id = $1 AND active = true',
      [userId]
    );

    const systemPrompt = `You are ${userInfo.business_name || 'a helpful'} assistant. 
Your job is to help website visitors by:
1. Answering questions about services and pricing
2. Capturing lead information (name, email, phone)
3. Booking appointments when requested

Available services:
${servicesResult.rows.map(s => `- ${s.name}: $${s.price} - ${s.description}`).join('\n')}

Contact: ${userInfo.phone || 'N/A'}
Email: ${userInfo.email || 'N/A'}

Be friendly, professional, and helpful. When you capture a lead or create a booking, let me know.`;

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: historyResult.rows.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    });

    const reply = response.content[0].text;

    // Save assistant response
    await pool.query(
      `INSERT INTO chat_messages (conversation_id, role, content, created_at)
       VALUES ($1, 'assistant', $2, CURRENT_TIMESTAMP)`,
      [conversationId, reply]
    );

    // Extract lead info if present (basic detection)
    const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    const phoneMatch = message.match(/\b\d{10}\b|\b\(\d{3}\)\s*\d{3}-\d{4}\b/);
    
    if (emailMatch || phoneMatch) {
      // Extract name from conversation
      const nameResult = await pool.query(
        `SELECT content FROM chat_messages 
         WHERE conversation_id = $1 AND role = 'user' 
         ORDER BY created_at ASC LIMIT 3`,
        [conversationId]
      );
      
      const possibleName = nameResult.rows.find(r => 
        r.content.toLowerCase().includes('my name is') ||
        r.content.toLowerCase().includes("i'm ") ||
        r.content.toLowerCase().includes('this is ')
      );

      const name = possibleName ? 
        possibleName.content.match(/(?:my name is|i'm|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)?.[1] :
        'Website Visitor';

      // Create lead
      await pool.query(
        `INSERT INTO leads (user_id, name, email, phone, source, status, created_at)
         VALUES ($1, $2, $3, $4, 'ai_chat_agent', 'new', CURRENT_TIMESTAMP)`,
        [userId, name, emailMatch?.[0], phoneMatch?.[0]]
      );
    }

    res.json({ reply });
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

module.exports = router;
