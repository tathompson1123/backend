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

// Configure Cloudinary from env vars
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// POST /api/upload - Upload an image, returns { url }
router.post('/', authenticateToken, upload.single('image'), async (req, res) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    return res.status(500).json({ error: 'Image uploads not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to your environment variables.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  try {
    // Upload from buffer using a stream
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
    console.error('Cloudinary upload error:', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

module.exports = router;
