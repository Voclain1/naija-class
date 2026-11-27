ALTER TABLE reminder_campaigns ADD COLUMN use_whatsapp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reminder_campaign_sends DROP CONSTRAINT reminder_campaign_sends_channel_used_check;
ALTER TABLE reminder_campaign_sends ADD CONSTRAINT reminder_campaign_sends_channel_used_check
    CHECK (channel_used IS NULL OR channel_used IN ('EMAIL', 'PUSH', 'SMS', 'WHATSAPP'));
ALTER TABLE reminder_campaign_sends ADD COLUMN invoice_id TEXT;
