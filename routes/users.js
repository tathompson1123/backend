const { purchasePhoneNumber } = require('../utils/twilio');

router.post('/provision-phone', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { areaCode } = req.body;

    // Check if user already has a number
    const user = await pool.query(
      'SELECT twilio_phone_number FROM users WHERE id = $1',
      [userId]
    );

    if (user.rows[0]?.twilio_phone_number) {
      return res.status(400).json({ error: 'You already have a phone number' });
    }

    // Purchase number
    const { phoneNumber, phoneSid } = await purchasePhoneNumber(areaCode, userId);

    // Update database
    await pool.query(
      'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = $2 WHERE id = $3',
      [phoneNumber, phoneSid, userId]
    );

    res.json({ phoneNumber, phoneSid });
  } catch (error) {
    console.error('Error provisioning phone:', error);
    res.status(500).json({ error: error.message });
  }
});
