ALTER TABLE notification_preferences
    ADD COLUMN paid_whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN wallet_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE;
