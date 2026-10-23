-- The school's public website (2026-10-22). Applied by migration
-- 20261118120000_school_website; kept here with the other policy files.
-- RLS: every table keyed on the school's GUC, FORCE so even the owner role obeys.
ALTER TABLE "school_websites"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_websites"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_posts"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_posts"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_albums"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_albums"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_photos"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_photos"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_reports" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "school_websites"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_posts"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_albums"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_photos"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_reports"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

