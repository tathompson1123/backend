// server.js - Backend API
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please try again later.'
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Website generation endpoint
app.post('/api/generate', limiter, async (req, res) => {
  try {
    const { prompt, style = 'professional' } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.length < 10) {
      return res.status(400).json({ 
        error: 'Invalid prompt. Please provide a detailed description.' 
      });
    }

    if (prompt.length > 10000) {
      return res.status(400).json({ 
        error: 'Prompt too long. Please keep it under 10000 characters.' 
      });
    }

    console.log('Generating website with prompt length:', prompt.length);

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Claude API Error:', errorData);
      return res.status(response.status).json({ 
        error: 'Failed to generate website. Please try again.',
        details: errorData.error?.message || 'Unknown error'
      });
    }

    const data = await response.json();
    const htmlContent = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    console.log('Successfully generated website');

    res.json({ 
      html: htmlContent,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error. Please try again later.',
      message: error.message
    });
  }
});

// Chat endpoint for AI agent
app.post('/api/chat', limiter, async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Invalid prompt' });
    }

    console.log('Processing chat message');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      throw new Error('Failed to get chat response');
    }

    const data = await response.json();
    const chatResponse = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    res.json({ 
      response: chatResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat message',
      message: error.message
    });
  }
});

// Booking endpoint
app.post('/api/bookings', async (req, res) => {
  try {
    const { name, email, phone, service, date, time, notes, businessName, businessType } = req.body;

    if (!name || !email || !phone || !service || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('New booking:', { name, email, date, time, businessName });

    const bookingData = {
      id: 'BK' + Date.now() + Math.random().toString(36).substr(2, 9).toUpperCase(),
      name,
      email,
      phone,
      service,
      date,
      time,
      notes,
      businessName,
      businessType,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    res.json({
      success: true,
      booking: bookingData,
      message: 'Booking confirmed successfully'
    });

  } catch (error) {
    console.error('Booking error:', error);
    res.status(500).json({ 
      error: 'Failed to process booking',
      message: error.message
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔑 API Key loaded:`, process.env.ANTHROPIC_API_KEY ? 'YES ✓' : 'NO ✗');
});
