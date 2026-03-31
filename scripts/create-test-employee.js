require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const TEST_EMAIL = 'appreview@sorceintegrations.com';
const TEST_PASSWORD = 'TestReview2026!';
const TEST_NAME = 'App Review';

async function createTestEmployee() {
  const client = await pool.connect();
  try {
    // Find a business owner (first user with a business name)
    const userResult = await client.query(
      `SELECT id, business_name FROM users WHERE business_name IS NOT NULL LIMIT 1`
    );

    if (userResult.rows.length === 0) {
      console.error('No business owner found in the database');
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log(`Using business: ${user.business_name} (user_id: ${user.id})`);

    // Check if test employee already exists
    const existing = await client.query(
      `SELECT e.id FROM employees e
       JOIN employee_credentials ec ON ec.employee_id = e.id
       WHERE ec.email = $1`,
      [TEST_EMAIL]
    );

    if (existing.rows.length > 0) {
      console.log('Test employee already exists. Updating password...');
      const hash = await bcrypt.hash(TEST_PASSWORD, 12);
      await client.query(
        `UPDATE employee_credentials SET password_hash = $1, updated_at = NOW()
         WHERE email = $2`,
        [hash, TEST_EMAIL]
      );
      console.log('\nTest account updated!');
    } else {
      // Create employee
      const empResult = await client.query(
        `INSERT INTO employees (user_id, name, email, phone, color, active, invite_status)
         VALUES ($1, $2, $3, $4, $5, true, 'accepted')
         RETURNING id`,
        [user.id, TEST_NAME, TEST_EMAIL, '(555) 000-0000', '#3b82f6']
      );

      const employeeId = empResult.rows[0].id;

      // Create credentials with password already set
      const hash = await bcrypt.hash(TEST_PASSWORD, 12);
      await client.query(
        `INSERT INTO employee_credentials (employee_id, email, password_hash, invite_accepted_at)
         VALUES ($1, $2, $3, NOW())`,
        [employeeId, TEST_EMAIL, hash]
      );

      console.log('\nTest employee created!');
    }

    console.log(`\n  Email:    ${TEST_EMAIL}`);
    console.log(`  Password: ${TEST_PASSWORD}`);
    console.log(`  Business: ${user.business_name}\n`);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

createTestEmployee();
