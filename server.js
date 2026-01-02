// server.js - Backend API with Authentication
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

// ===================================
// IN-MEMORY USER STORAGE (TEMPORARY)
// ===================================
// NOTE: In production, use a real database (MongoDB, PostgreSQL, etc.)
let users = []; // { id, name, email, password, plan, createdAt, websites: [] }
let sessions = []; // { userId, token, createdAt }

// Helper function to generate simple token
function generateToken() {
  return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

// Helper function to hash password (VERY SIMPLE - use bcrypt in production!)
function hashPassword(password) {
  // WARNING: This is NOT secure! Use bcrypt in production
  return Buffer.from(password).toString('base64');
}

// Helper function to verify password
function verifyPassword(password, hashedPassword) {
  return hashPassword(password) === hashedPassword;
}

// ===================================
// AUTHENTICATION ENDPOINTS
// ===================================

// Signup endpoint
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, plan } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Create new user
    const newUser = {
      id: Date.now().toString(),
      name,
      email: email.toLowerCase(),
      password: hashPassword(password),
      plan: plan || 'pro-plan',
      createdAt: new Date().toISOString(),
      websites: []
    };

    users.push(newUser);

    // Create session token
    const token = generateToken();
    sessions.push({
      userId: newUser.id,
      token,
      createdAt: new Date().toISOString()
    });

    console.log('New user signed up:', email);

    // Return user data (without password) and token
    res.json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        plan: newUser.plan,
        createdAt: newUser.createdAt
      },
      token
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    if (!verifyPassword(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create session token
    const token = generateToken();
    sessions.push({
      userId: user.id,
      token,
      createdAt: new Date().toISOString()
    });

    console.log('User logged in:', email);

    // Return user data (without password) and token
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        createdAt: user.createdAt
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Remove session
    sessions = sessions.filter(s => s.token !== token);

    console.log('User logged out');

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Get current user (verify token)
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Find session
    const session = sessions.find(s => s.token === token);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Find user
    const user = users.find(u => u.id === session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return user data (without password)
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        createdAt: user.createdAt,
        websites: user.websites
      }
    });

  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Failed to verify authentication' });
  }
});

// ===================================
// WEBSITE MANAGEMENT ENDPOINTS
// ===================================

// Save website for user
app.post('/api/websites/save', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { html, businessName, businessType } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Find session and user
    const session = sessions.find(s => s.token === token);
    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const user = users.find(u => u.id === session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Save website
    const website = {
      id: Date.now().toString(),
      html,
      businessName,
      businessType,
      createdAt: new Date().toISOString(),
      published: false
    };

    user.websites = user.websites || [];
    user.websites.push(website);

    console.log('Website saved for user:', user.email);

    res.json({
      success: true,
      website
    });

  } catch (error) {
    console.error('Save website error:', error);
    res.status(500).json({ error: 'Failed to save website' });
  }
});

// Get user's websites
app.get('/api/websites', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const session = sessions.find(s => s.token === token);
    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const user = users.find(u => u.id === session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      websites: user.websites || []
    });

  } catch (error) {
    console.error('Get websites error:', error);
    res.status(500).json({ error: 'Failed to get websites' });
  }
});

// ===================================
// EXISTING ENDPOINTS
// ===================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    users: users.length,
    sessions: sessions.length
  });
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
        model: 'claude-haiku-4-20250514', // Opus 4 for highest quality designs
        max_tokens: 8000, // Higher limit for more complex/polished code
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
  console.log(`👤 Auth endpoints ready`);
});

