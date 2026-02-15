const jwt = require('jsonwebtoken');
const { EFFECTIVE_JWT_SECRET } = require('./middleware');
const { pool } = require('./database');

const DEFAULT_PERMISSIONS = {
  view_bookings: true,
  manage_bookings: true,
  view_customers: true,
  view_all_bookings: false,
  send_messages: true,
  process_payments: false,
  view_reports: false
};

async function authenticateEmployee(req, res, next) {
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

    // Verify employee is still active and load permissions
    const activeCheck = await pool.query(
      `SELECT e.active, e.permissions FROM employees e
       JOIN employee_credentials ec ON ec.employee_id = e.id
       WHERE e.id = $1`,
      [decoded.employeeId]
    );

    if (!activeCheck.rows.length || !activeCheck.rows[0].active) {
      return res.status(403).json({ error: 'Account deactivated or removed' });
    }

    req.employee = {
      employeeId: decoded.employeeId,
      userId: decoded.userId,
      email: decoded.email,
      permissions: activeCheck.rows[0].permissions || DEFAULT_PERMISSIONS
    };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (req.employee?.permissions?.[permissionKey]) {
      return next();
    }
    res.status(403).json({ error: 'Permission denied', required: permissionKey });
  };
}

module.exports = { authenticateEmployee, requirePermission };
