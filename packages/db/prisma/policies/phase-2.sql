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

-- ---------------------------------------------------------------------
-- Slice 2 — assessment (assessment_scores, assessments). Raw marks +
-- their denormalized per-(student × subject × term) summary. Both carry
-- their own school_id → flat direct-column check (NOT EXISTS-through-
-- component): a score row's school_id is the tenancy guard, independent
-- of the grading_components FK.
-- ---------------------------------------------------------------------

ALTER TABLE "assessment_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_scores" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "assessments"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessments"       FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "assessment_scores"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON "assessments"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ---------------------------------------------------------------------
-- Slice 5 — report_cards. The materialized per-(student × term) report-card
-- artifact (rollup + workflow state + comments + R2 PDF pointer). Own
-- school_id → flat direct-column check. The 8th and final Phase 2 table.
-- ---------------------------------------------------------------------

ALTER TABLE "report_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_cards" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "report_cards"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ---------------------------------------------------------------------
-- Slice 7 — attendance_records. Daily attendance (universal). One row per
-- (student × date); own school_id → flat direct-column check. The
-- subject-period table (subject_attendance_records) lands in slice 8.
-- ---------------------------------------------------------------------

ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_records" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "attendance_records"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ---------------------------------------------------------------------
-- Slice 8 — subject_attendance_records. Subject-period attendance (opt-in via
-- School.subjectAttendanceEnabled — the flag gates the API, RLS gates the rows).
-- One row per (student × subject × date × period); own school_id → flat
-- direct-column check.
-- ---------------------------------------------------------------------

ALTER TABLE "subject_attendance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subject_attendance_records" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "subject_attendance_records"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
