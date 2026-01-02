// server.js - Updated Backend API with Custom Design Styles
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for Railway/production environments
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow all Vercel deployments + localhost
    const allowedOrigins = [
      /\.vercel\.app$/,  // All Vercel domains
      'http://localhost:5173',
      'http://localhost:3000'
    ];
    
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check if origin matches
    const isAllowed = allowedOrigins.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(origin);
      }
      return pattern === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased from 20 to 100 requests per 15 minutes
  message: 'Too many requests, please try again in a few minutes.'
});

// CUSTOM DESIGN SYSTEM PROMPTS
const DESIGN_STYLES = {
  modern: `You are an expert web designer specializing in modern, clean designs.
Design Guidelines:
- Use modern color schemes (gradients, bold accents)
- Implement smooth animations and transitions
- Use contemporary fonts (Inter, Plus Jakarta Sans, or similar)
- Include glass-morphism effects where appropriate
- Add subtle shadows and rounded corners
- Use flexbox/grid for responsive layouts
- Include hover effects and micro-interactions
- Optimize for mobile-first design`,

  luxury: `You are an expert web designer specializing in luxury, premium designs.
Design Guidelines:
- Use elegant color palettes (gold, navy, white, black)
- Implement serif fonts for headings (Playfair Display, Cormorant)
- Add subtle animations and parallax effects
- Use high-quality imagery placeholders
- Include generous white space
- Add premium textures and patterns
- Use sophisticated transitions
- Implement dark mode with gold accents`,

  minimal: `You are an expert web designer specializing in minimalist designs.
Design Guidelines:
- Use simple color schemes (black, white, one accent color)
- Implement clean typography (Helvetica, Arial, system fonts)
- Maximum white space for breathing room
- Remove all unnecessary elements
- Use simple geometric shapes
- No gradients or heavy shadows
- Focus on content hierarchy
- Clean, crisp layouts`,

  playful: `You are an expert web designer specializing in playful, creative designs.
Design Guidelines:
- Use vibrant, bold color combinations
- Implement fun, rounded fonts (Poppins, Nunito, Comic Neue)
- Add playful animations and bouncy effects
- Use illustrations and icons
- Include fun hover states and interactions
- Add colorful gradients and patterns
- Use asymmetric layouts where appropriate
- Make it feel energetic and fun`,

  professional: `You are an expert web designer specializing in corporate, professional designs.
Design Guidelines:
- Use corporate color schemes (blues, grays, white)
- Implement professional fonts (Roboto, Open Sans, Lato)
- Clean, structured layouts with clear hierarchy
- Include trust indicators (testimonials, stats)
- Use professional imagery
- Add subtle shadows and borders
- Ensure readability and accessibility
- Corporate-appropriate animations`,

  ecommerce: `You are an expert web designer specializing in e-commerce designs.
Design Guidelines:
- Use conversion-optimized layouts
- Implement clear call-to-action buttons
- Add product grid/card layouts
- Include pricing tables and comparison features
- Use trust badges and security indicators
- Add shopping cart and checkout elements
- Implement filters and search functionality
- Use high-quality product image placeholders
- Add reviews and ratings sections`,
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Website generation endpoint
app.post('/api/generate', limiter, async (req, res) => {
  try {
    const { prompt, style = 'modern' } = req.body;

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

    // Get the design style system prompt
    const designSystemPrompt = DESIGN_STYLES[style] || DESIGN_STYLES.modern;

    // Construct the full prompt with design guidance
    const fullPrompt = `${designSystemPrompt}

USER REQUEST:
${prompt}

REQUIREMENTS:
- Generate a complete, single-file HTML website
- Include all CSS in a <style> tag in the <head>
- Include all JavaScript in a <script> tag before </body>
- Use Tailwind CSS CDN: <script src="https://cdn.tailwindcss.com"></script>
- Make it fully responsive (mobile, tablet, desktop)
- Include placeholder images using https://images.unsplash.com/photo-[relevant-id]?w=800
- Add smooth animations and transitions
- Ensure all interactive elements work
- Include meta tags for SEO
- Make the design ${style} style

Return ONLY the complete HTML code, no explanations.`;

    console.log('Generating website with style:', style, 'prompt length:', prompt.length);

    // Call Claude API with system message
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929', // Sonnet 4.5 - Good balance: $0.03 per generation
        // Haiku struggles with complex HTML, Sonnet is much better!
        // For production premium quality: 'claude-opus-4-20250514' ($0.15)
        max_tokens: 12000, // More tokens for complete website
        system: designSystemPrompt, // Add system prompt for consistent styling
        messages: [{
          role: 'user',
          content: fullPrompt
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

    console.log('Successfully generated website with', style, 'style');

    res.json({ 
      html: htmlContent,
      style: style,
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

// Get available design styles
app.get('/api/styles', (req, res) => {
  res.json({
    styles: Object.keys(DESIGN_STYLES),
    default: 'modern'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Chat endpoint for AI agent
app.post('/api/chat', limiter, async (req, res) => {
  try {
    const { prompt, conversationHistory = [] } = req.body;

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
        max_tokens: 500, // Shorter responses for chat
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

    // Validate required fields
    if (!name || !email || !phone || !service || !date || !time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('New booking:', { name, email, date, time, businessName });

    // Here you would typically:
    // 1. Save to database
    // 2. Send confirmation email to customer
    // 3. Send notification to business owner
    // 4. Integrate with calendar (Google Calendar API, etc.)

    // For now, we'll just log it and return success
    // In production, integrate with your email service (SendGrid, Mailgun, etc.)

    const bookingData = {
      id: generateBookingId(),
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

    // TODO: Send confirmation email
    // await sendConfirmationEmail(bookingData);

    // TODO: Send notification to business
    // await sendBusinessNotification(bookingData);

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

function generateBookingId() {
  return 'BK' + Date.now() + Math.random().toString(36).substr(2, 9).toUpperCase();
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔑 API Key loaded:`, process.env.ANTHROPIC_API_KEY ? 'YES ✓' : 'NO ✗');
  console.log(`🎨 Available styles:`, Object.keys(DESIGN_STYLES).join(', '));
});
