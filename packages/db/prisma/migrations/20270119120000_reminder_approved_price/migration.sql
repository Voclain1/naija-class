ALTER TABLE reminder_campaigns
    ADD COLUMN approved_sms_unit_kobo INTEGER CHECK (approved_sms_unit_kobo >= 0),
    ADD COLUMN approved_whatsapp_unit_kobo INTEGER CHECK (approved_whatsapp_unit_kobo >= 0);
