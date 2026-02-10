const jwt = require('jsonwebtoken');
const { EFFECTIVE_JWT_SECRET } = require('./middleware');

function authenticateEmployee(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);

    if (decoded.role !== 'employee') {
      return res.status(403).json({ error: 'Employee access required' });
    }

    req.employee = {
      employeeId: decoded.employeeId,
      userId: decoded.userId,
      email: decoded.email
    };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticateEmployee };
