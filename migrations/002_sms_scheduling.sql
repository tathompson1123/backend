-- ============================================
-- MIGRATION 002: SMS Scheduling
-- Adds DB-backed scheduling so SMS sends survive server restarts.
-- Previously used in-process setTimeout (lost on restart).
-- ============================================

-- Add scheduling columns to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sms_scheduled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sms_failed_at    TIMESTAMP;

-- Partial index: only index rows that are actually pending.
-- Keeps the cron query fast.
CREATE INDEX IF NOT EXISTS idx_leads_sms_pending
  ON leads(sms_scheduled_at)
  WHERE status = 'sms_pending';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leads'
  AND column_name IN ('sms_scheduled_at', 'sms_failed_at');

DO $$
BEGIN
  RAISE NOTICE '✅ Migration 002 complete: SMS scheduling columns added';
END $$;
