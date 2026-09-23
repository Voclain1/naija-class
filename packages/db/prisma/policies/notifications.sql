-- Notifications v1 RLS policies (docs/modules/notifications-v1.md N6). Same
-- discipline as every policy file: ENABLE + FORCE, WITH CHECK on the tenant
-- policy. Source of truth; migration 20260923120000_notifications_v1 copies
-- this block verbatim.
--
-- device_tokens is NOT here: it was already ENABLE + FORCE'd by the phase-6
-- policy file, and this release only adds a nullable user_id column to it.

ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON notification_deliveries
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
