const { Pool } = require('pg');

// Enable SSL whenever the DB host isn't localhost. Railway's proxy (rlwy.net) requires
// SSL even from a dev machine, and gating on NODE_ENV=production meant local dev was
// trying to connect without TLS and silently failing the handshake.
const dbUrl = process.env.DATABASE_URL || '';
const isLocalDb = /@(localhost|127\.0\.0\.1)/.test(dbUrl);

const pool = new Pool({
  connectionString: dbUrl,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  max: 10,                  // cap concurrent connections (Railway Postgres limit)
  idleTimeoutMillis: 30000, // release idle connections after 30s
  connectionTimeoutMillis: 15000, // Railway's proxy + TLS handshake from a dev box can take 5–10s
  // Keep TCP alive so Railway's proxy doesn't drop idle connections out from under us
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Without this listener, an error event on an idle pooled client (e.g. when Railway's
// proxy drops a stale connection) is unhandled and crashes the whole process. pg's docs
// require attaching a handler so the bad client gets evicted and the next acquire opens
// a fresh one.
pool.on('error', (err) => {
  console.error('⚠️ Idle pg client error (connection will be evicted):', err.message);
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

module.exports = { pool };
