-- Phase 8 RLS policies. Same discipline as phase-0.sql … phase-7.sql:
--   1. ENABLE + FORCE so the table owner cannot bypass policies by accident;
--      the runtime app_user has neither SUPERUSER nor BYPASSRLS.
--   2. WITH CHECK on every tenant policy so a buggy service cannot INSERT a row
--      carrying another school's school_id.
--
-- This file is the SOURCE OF TRUTH for Phase 8 policies. Each CP's migration
-- copies its tables' blocks here verbatim.

-- ---------------------------------------------------------------------
-- CP1 — Event Calendar (docs/modules/phase-8.md §15).
-- Migration: 20260913120000_phase_8_cp1_calendar
--
-- national_events is PLATFORM data, the first content table with no
-- school_id. It is readable by everyone and writable by NO runtime role,
-- enforced twice (D22):
--   layer 1 — FORCE RLS with a SELECT-only policy and no write policy;
--   layer 2 — REVOKE INSERT, UPDATE, DELETE FROM app_user.
-- Writes happen only in migrations. calendar-rls.spec.ts proves both layers
-- against a real database.
-- ---------------------------------------------------------------------

ALTER TABLE "national_events"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "national_events"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_events"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_events"                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_hidden_national_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_hidden_national_events" FORCE  ROW LEVEL SECURITY;

CREATE POLICY national_events_read_all ON national_events
  FOR SELECT
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON "national_events" FROM app_user;

CREATE POLICY tenant_isolation ON school_events
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON school_hidden_national_events
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
