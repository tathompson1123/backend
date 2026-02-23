const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { authenticateToken } = require('../config/middleware');

// Use memory storage — upload buffer directly to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helper: configure Cloudinary fresh from current env vars each call
function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// GET /api/upload/test — Verify Cloudinary credentials (returns config status)
router.get('/test', authenticateToken, async (req, res) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.json({
      configured: false,
      missing: [
        !cloudName && 'CLOUDINARY_CLOUD_NAME',
        !apiKey && 'CLOUDINARY_API_KEY',
        !apiSecret && 'CLOUDINARY_API_SECRET',
      ].filter(Boolean),
      cloudName: cloudName || '(not set)',
    });
  }

  configureCloudinary();

  try {
    const ping = await cloudinary.api.ping();
    res.json({
      configured: true,
      status: ping.status,
      cloudName,
    });
  } catch (err) {
    res.json({
      configured: false,
      cloudName,
      error: err.message,
      httpCode: err.http_code || null,
      hint: err.http_code === 401
        ? 'API key or secret is wrong'
        : err.http_code === 404
        ? 'Cloud name not found — check your Cloudinary dashboard for the correct cloud name'
        : 'Unknown Cloudinary error',
    });
  }
});

// POST /api/upload - Upload an image, returns { url }
router.post('/', authenticateToken, upload.single('image'), async (req, res) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({
      error: `Cloudinary not fully configured. Missing: ${[
        !cloudName && 'CLOUDINARY_CLOUD_NAME',
        !apiKey && 'CLOUDINARY_API_KEY',
        !apiSecret && 'CLOUDINARY_API_SECRET',
      ].filter(Boolean).join(', ')}`
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  configureCloudinary();

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `sorce/${req.user.userId}`,
          resource_type: 'image',
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary upload error:', err.message, '| http_code:', err.http_code);

    let userMessage = 'Upload failed: ' + err.message;
    if (err.http_code === 401) {
      userMessage = 'Cloudinary authentication failed — check your API key and secret';
    } else if (err.http_code === 404 || (err.message || '').includes('DOCTYPE')) {
      userMessage = `Cloudinary cloud name "${cloudName}" not found. Open your Cloudinary dashboard home page — the cloud name is shown there (not the API key label).`;
    }

    res.status(500).json({ error: userMessage });
  }
});

module.exports = router;
