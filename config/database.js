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
  // Don't let a single slow/hung query pin a pooled client forever. With ~8 crons
  // sharing max:10, one stuck query during a DB slowdown can starve everything else,
  // which is what turns a brief blip into a flood of acquire-timeout errors.
  statement_timeout: 30000,  // Postgres cancels a query running >30s
  query_timeout: 30000,      // client-side guard so a query that never responds is released
  application_name: 'sorce-backend', // shows up in pg_stat_activity for debugging
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
