// Accounts comped to unlimited usage across chat agent, SMS, and email — keyed by email
// (lowercased) so it survives plan changes and DB user-id differences between environments.
// This is the single source of truth; SMS/chat/email enforcement all consult it.
const UNLIMITED_ACCOUNTS = new Set([
  'ty@thompsonsautodetailing.com', // Thompson's Auto Detailing (comped)
]);

const isUnlimitedAccount = (email) =>
  UNLIMITED_ACCOUNTS.has(String(email || '').trim().toLowerCase());

module.exports = { UNLIMITED_ACCOUNTS, isUnlimitedAccount };
