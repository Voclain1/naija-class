-- School web addresses: RLS (docs/modules/school-addresses.md, 2026-10-22).
-- Migration: 20261117120000_school_addresses. SOURCE OF TRUTH; the migration
-- carries the same block verbatim.
--
-- school_previous_addresses holds each school's earlier codes. Read by
-- everyone (public pages resolve a code before a school is known; codes are
-- public, as schools.slug is), written only under the school's own GUC, never
-- edited.

ALTER TABLE "school_previous_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_previous_addresses" FORCE  ROW LEVEL SECURITY;

CREATE POLICY school_previous_addresses_read_all ON school_previous_addresses
  FOR SELECT
  USING (true);

CREATE POLICY school_previous_addresses_insert_own ON school_previous_addresses
  FOR INSERT
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY school_previous_addresses_delete_own ON school_previous_addresses
  FOR DELETE
  USING (school_id::text = current_setting('app.current_school_id', true));

REVOKE UPDATE ON "school_previous_addresses" FROM app_user;
