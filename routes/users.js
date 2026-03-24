const { purchasePhoneNumber } = require('../utils/twilio');

router.post('/provision-phone', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Check if user already has a number
    const userRow = await pool.query(
      `SELECT u.twilio_phone_number, bi.zip_code
       FROM users u
       LEFT JOIN business_information bi ON bi.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    if (userRow.rows[0]?.twilio_phone_number) {
      return res.status(400).json({ error: 'You already have a phone number' });
    }

    // Purchase number based on business zip code
    const { phoneNumber, phoneSid } = await purchasePhoneNumber({
      zipCode: userRow.rows[0]?.zip_code,
      userId
    });

    // Update database
    await pool.query(
      'UPDATE users SET twilio_phone_number = $1, twilio_phone_sid = $2 WHERE id = $3',
      [phoneNumber, phoneSid, userId]
    );

    res.json({ phoneNumber, phoneSid });
  } catch (error) {
    console.error('Error provisioning phone:', error.message);
    res.status(500).json({ error: error.message });
  }
});
