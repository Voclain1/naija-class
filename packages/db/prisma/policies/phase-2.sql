-- Phase 2 RLS policies. Same discipline as phase-0.sql / phase-1.sql:
--   1. ENABLE + FORCE so the table owner (school_kit migration role) cannot
--      bypass policies; the runtime app_user has neither SUPERUSER nor BYPASSRLS.
--   2. WITH CHECK on every policy so a buggy controller cannot INSERT a row
--      carrying another school's school_id.
--   3. Flat school_id check on every table — all eight Phase 2 tables carry
--      school_id directly (no EXISTS-through-parent needed).
--
-- This file is the SOURCE OF TRUTH for Phase 2 policies and is built up slice
-- by slice. Each slice's migration appends its tables' blocks here verbatim and
-- copies the same SQL into the migration. Slice 1 lands the three grading-config
-- tables; slices 2/5/7/8 append assessment_scores, assessments, report_cards,
-- attendance_records, subject_attendance_records.

-- ---------------------------------------------------------------------
-- Slice 1 — grading configuration (grading_schemes, grading_components,
-- grade_boundaries). Per-school config, seeded at signup, fully editable.
-- ---------------------------------------------------------------------

ALTER TABLE "grading_schemes"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grading_schemes"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "grading_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grading_components" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "grade_boundaries"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grade_boundaries"   FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "grading_schemes"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON "grading_components"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON "grade_boundaries"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
