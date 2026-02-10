const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateEmployee } = require('../config/employee-middleware');

// All routes require employee authentication
router.use(authenticateEmployee);

// GET /api/employee/my-bookings - Bookings assigned to this employee
router.get('/my-bookings', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { startDate, endDate, status } = req.query;

    let query = `
      SELECT b.*,
        json_agg(
          json_build_object(
            'service_name', bi.service_name,
            'duration', bi.service_duration,
            'price', bi.service_price,
            'quantity', bi.quantity
          )
        ) as items
      FROM bookings b
      LEFT JOIN booking_items bi ON b.id = bi.booking_id
      WHERE b.user_id = $1 AND b.employee_id = $2
    `;

    const params = [userId, employeeId];
    let paramCount = 2;

    if (startDate) {
      paramCount++;
      query += ` AND b.booking_date >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND b.booking_date <= $${paramCount}`;
      params.push(endDate);
    }

    if (status) {
      paramCount++;
      query += ` AND b.status = $${paramCount}`;
      params.push(status);
    }

    query += ' GROUP BY b.id ORDER BY b.booking_date, b.start_time';

    const result = await pool.query(query, params);
    res.json({ bookings: result.rows });
  } catch (error) {
    console.error('Error fetching employee bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// GET /api/employee/my-bookings/:id - Single booking detail
router.get('/my-bookings/:id', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;

    const result = await pool.query(
      `SELECT b.*,
        json_agg(
          json_build_object(
            'service_name', bi.service_name,
            'duration', bi.service_duration,
            'price', bi.service_price,
            'quantity', bi.quantity
          )
        ) as items
       FROM bookings b
       LEFT JOIN booking_items bi ON b.id = bi.booking_id
       WHERE b.id = $1 AND b.user_id = $2 AND b.employee_id = $3
       GROUP BY b.id`,
      [id, userId, employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ booking: result.rows[0] });
  } catch (error) {
    console.error('Error fetching booking detail:', error);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

// PUT /api/employee/my-bookings/:id/status - Update booking status (limited options)
router.put('/my-bookings/:id/status', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['in_progress', 'completed', 'no_show'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowedStatuses.join(', ')}` });
    }

    const result = await pool.query(
      `UPDATE bookings SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND employee_id = $4
       RETURNING *`,
      [status, id, userId, employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // If completed, update customer lifetime value
    if (status === 'completed') {
      const booking = result.rows[0];
      try {
        await pool.query(
          `UPDATE customers
           SET total_jobs = total_jobs + 1,
               lifetime_value = lifetime_value + $1,
               last_service_date = $2,
               updated_at = NOW()
           WHERE user_id = $3 AND (email = $4 OR phone = $5)`,
          [booking.total_amount || 0, booking.booking_date, userId, booking.customer_email, booking.customer_phone]
        );
      } catch (custErr) {
        console.error('Error updating customer on complete:', custErr);
      }
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ error: 'Failed to update booking status' });
  }
});

// PUT /api/employee/my-bookings/:id/notes - Update job notes
router.put('/my-bookings/:id/notes', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { id } = req.params;
    const { jobNotes } = req.body;

    const result = await pool.query(
      `UPDATE bookings SET job_notes = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND employee_id = $4
       RETURNING *`,
      [jobNotes, id, userId, employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Error updating job notes:', error);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

// GET /api/employee/my-schedule - Today's schedule with upcoming bookings
router.get('/my-schedule', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;
    const { date } = req.query; // optional, defaults to today

    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT b.*,
        json_agg(
          json_build_object(
            'service_name', bi.service_name,
            'duration', bi.service_duration,
            'price', bi.service_price,
            'quantity', bi.quantity
          )
        ) as items
       FROM bookings b
       LEFT JOIN booking_items bi ON b.id = bi.booking_id
       WHERE b.user_id = $1 AND b.employee_id = $2
         AND b.booking_date = $3
         AND b.status NOT IN ('cancelled')
       GROUP BY b.id
       ORDER BY b.start_time`,
      [userId, employeeId, targetDate]
    );

    res.json({ date: targetDate, bookings: result.rows });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// GET /api/employee/services - Services this employee is assigned to
router.get('/services', async (req, res) => {
  try {
    const { employeeId, userId } = req.employee;

    // Check if employee has specific service assignments
    const assignedServices = await pool.query(
      'SELECT service_id FROM service_employees WHERE employee_id = $1',
      [employeeId]
    );

    let result;
    if (assignedServices.rows.length > 0) {
      // Return only assigned services
      const serviceIds = assignedServices.rows.map(r => r.service_id);
      result = await pool.query(
        `SELECT id, name, description, duration_hours, price
         FROM services
         WHERE user_id = $1 AND id = ANY($2) AND active = true
         ORDER BY name`,
        [userId, serviceIds]
      );
    } else {
      // No specific assignments = can do all services
      result = await pool.query(
        `SELECT id, name, description, duration_hours, price
         FROM services
         WHERE user_id = $1 AND active = true
         ORDER BY name`,
        [userId]
      );
    }

    res.json({ services: result.rows });
  } catch (error) {
    console.error('Error fetching employee services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// GET /api/employee/profile - Employee's own profile
router.get('/profile', async (req, res) => {
  try {
    const { employeeId } = req.employee;

    const result = await pool.query(
      `SELECT e.id, e.name, e.email, e.phone, e.color, e.active,
              u.business_name,
              ec.last_login_at
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
       WHERE e.id = $1`,
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error('Error fetching employee profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/employee/profile - Update own phone and email
router.put('/profile', async (req, res) => {
  try {
    const { employeeId } = req.employee;
    const { phone, email } = req.body;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone);
    }

    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email.toLowerCase().trim());

      // Also update employee_credentials email
      await pool.query(
        'UPDATE employee_credentials SET email = $1, updated_at = NOW() WHERE employee_id = $2',
        [email.toLowerCase().trim(), employeeId]
      );
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(employeeId);
    const result = await pool.query(
      `UPDATE employees SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING id, name, email, phone, color`,
      values
    );

    res.json({ success: true, profile: result.rows[0] });
  } catch (error) {
    console.error('Error updating employee profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
