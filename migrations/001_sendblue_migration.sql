-- ============================================
-- MIGRATION: Twilio to SendBlue
-- Date: 2025-01-19
-- ============================================

-- Update sms_messages table structure
ALTER TABLE sms_messages 
  DROP COLUMN IF EXISTS twilio_sid,
  DROP COLUMN IF EXISTS from_number,
  ADD COLUMN IF NOT EXISTS sendblue_message_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS from_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sms_sendblue_id ON sms_messages(sendblue_message_id);
CREATE INDEX IF NOT EXISTS idx_sms_lead_id ON sms_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_messages(status);

-- Update any existing NULL values
UPDATE sms_messages SET status = 'sent' WHERE status IS NULL AND direction = 'outgoing';
UPDATE sms_messages SET status = 'received' WHERE status IS NULL AND direction = 'incoming';

-- Add indexes to leads table for performance
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_user_created ON leads(user_id, created_at DESC);

-- Verify changes
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'sms_messages'
ORDER BY ordinal_position;

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Migration complete: SendBlue integration ready';
END $$;
