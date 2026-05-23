-- Phase 1 RLS policies. Same discipline as phase-0.sql:
--   1. ENABLE + FORCE so the table owner (school_kit migration role) cannot
--      bypass policies. The runtime app_user role has neither SUPERUSER nor
--      BYPASSRLS — see CLAUDE.md "Multi-tenancy" hard rules.
--   2. WITH CHECK on every policy so a buggy controller cannot INSERT a row
--      with another school's school_id.
--   3. Direct school_id check (no EXISTS-through-parent): terms.school_id is
--      denormalised from academic_year.school_id at write time, exactly the
--      pattern subsequent Phase 1 tables (enrollments, class_arms, …) will
--      copy.
--
-- Partial unique indexes for "exactly one current per school" are declared
-- here too — Prisma's @@unique cannot express the WHERE clause, so the SQL
-- form is authoritative. The service layer's setCurrent* helpers cooperate
-- with these indexes by flipping the sibling rows in the same transaction.

-- Slice 1: academic_years + terms --------------------------------------

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years FORCE  ROW LEVEL SECURITY;
ALTER TABLE terms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms          FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON academic_years
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON terms
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Partial unique indexes — "exactly one current per school" -----------
-- Without these, two rows could be is_current=true for the same school during
-- a sloppy update. The service uses a single withTenant transaction to flip
-- siblings to false BEFORE flipping the target to true, but the partial
-- index is the correct-by-construction guard. Naming follows Prisma's
-- "<table>_<columns>_key" convention so failures surface a recognisable name.

CREATE UNIQUE INDEX academic_years_school_id_current_key
  ON academic_years (school_id)
  WHERE is_current = true;

CREATE UNIQUE INDEX terms_school_id_current_key
  ON terms (school_id)
  WHERE is_current = true;

-- Slice 2: class_levels -------------------------------------------------
-- Direct school_id check, same shape as slices above. No partial unique
-- (no "current level" concept). The seed-on-signup that populates the
-- 14 default rows runs INSIDE the signupOwner transaction using the same
-- `tx` handle as the school/user/userRole inserts — the GUC is already set
-- by `set_config('app.current_school_id', school.id, true)` earlier in
-- that tx, so RLS WITH CHECK is satisfied without needing withTenant
-- (which would nest $transaction and Prisma does not nest). See the seed
-- call-site comment in apps/api/src/modules/auth/auth.service.ts.

ALTER TABLE class_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_levels FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON class_levels
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Slice 3: class_arms + subjects + class_subjects ----------------------
-- All three carry their own school_id and use the same direct-RLS shape as
-- slices 1+2. class_subjects is an explicit join (ClassLevel × Subject)
-- with denormalised school_id rather than EXISTS-through-parent — matches
-- the pattern explicitly documented for student_guardians, mastery_records,
-- and ai_interaction_logs (docs/modules/phase-1.md "Note on
-- student_guardians"). The service layer writes school_id from the parent
-- on create; the WITH CHECK clause is the guard against a buggy controller
-- ever inserting with a foreign school_id.

ALTER TABLE class_arms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_arms     FORCE  ROW LEVEL SECURITY;
ALTER TABLE subjects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects       FORCE  ROW LEVEL SECURITY;
ALTER TABLE class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_subjects FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON class_arms
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON subjects
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON class_subjects
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
