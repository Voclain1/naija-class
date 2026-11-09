-- Durable fee reminder campaigns (docs/modules/reminder-campaigns.md).
-- Applied by migration 20261210120000_reminder_campaigns.
ALTER TABLE "reminder_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminder_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reminder_campaigns"
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));

ALTER TABLE "reminder_campaign_sends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminder_campaign_sends" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reminder_campaign_sends"
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
