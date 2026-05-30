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

-- Slice 4: students ---------------------------------------------------
-- Direct school_id check, same shape as every prior Phase 1 slice. The
-- service layer writes school_id from the JWT-resolved tenant; the
-- WITH CHECK clause is the guard against a buggy controller ever
-- inserting with a foreign school_id. SECURITY DEFINER count stays at 4
-- — every Student endpoint is post-authentication and post-tenant, so
-- withTenant() covers all DB access; no escape hatch needed.

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON students
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Slice 5: guardians + student_guardians ------------------------------
-- Same direct-school_id shape as every prior Phase 1 slice. Both tables
-- carry their own school_id (student_guardians denormalises from its
-- parents at write time) so policy enforcement is a single column check
-- — see the "Note on student_guardians" in docs/modules/phase-1.md for
-- the rationale against EXISTS-through-parent. SECURITY DEFINER count
-- stays at 4 — every endpoint in this slice is post-authentication and
-- post-tenant; withTenant() covers all DB access.

ALTER TABLE guardians         ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians         FORCE  ROW LEVEL SECURITY;
ALTER TABLE student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guardians FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guardians
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON student_guardians
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Slice 6: import_jobs ------------------------------------------------
-- CSV import bookkeeping. Same direct-school_id shape. The notable
-- thing about this table is its writers: it's the FIRST table written
-- by a BullMQ worker (the validate processor), not just by a request
-- handler. The worker establishes tenant context from job.data.schoolId
-- via the tenantWorker() wrapper (apps/api/src/common/queue/
-- tenant-worker.ts) BEFORE any DB access — so withTenant() runs, the
-- GUC is set, and this policy enforces isolation identically for
-- worker writes as for handler writes. There is no window in which
-- the worker can touch import_jobs (or any other RLS'd table) without
-- the GUC set; if a processor were ever wired without tenantWorker(),
-- RLS would simply return zero rows / WITH CHECK would reject every
-- INSERT, failing loud rather than leaking. SECURITY DEFINER count
-- stays at 4 — no pre-tenant access path is needed by this slice.

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON import_jobs
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Slice 9: enrollments ------------------------------------------------
-- Per-term enrollment. school_id is denormalised from term.school_id
-- (which is itself denormalised from academic_year.school_id at write
-- time), giving every read/write a direct school_id column to filter
-- against — same pattern as student_guardians. No joined-through-
-- parent EXISTS subquery needed.
--
-- The columns academic_year_id and term_id are tenant-scoped via this
-- policy on enrollments; the service layer additionally enforces the
-- invariant academic_year_id = term.academic_year_id at write time
-- (resolved server-side from termId; the API never accepts
-- academicYearId from the request body). A Phase 2 trigger or CHECK
-- constraint could enforce this at the DB layer; Phase 1 ships the
-- service-layer guarantee with full test coverage on every write path.
--
-- Writers: only request handlers in slice 9 (no BullMQ worker yet —
-- slice 11+ may add the promotion engine on the imports queue, which
-- would land here via the same tenantWorker() wrapper as slice 6's
-- imports worker). SECURITY DEFINER count stays at 4.

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON enrollments
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Slice 10: teacher_profiles -------------------------------------------
-- HR profile for teacher-role users. Direct school_id column (the userId
-- FK is to a same-tenant User, but we carry our own school_id for the
-- cheap direct-filter pattern every Phase 1 table uses — no join-through-
-- parent EXISTS subquery). Created by admin request handlers only; the
-- invitation-accept path does NOT touch this table (no auto-create on
-- accept — Q2 lifecycle locked 2026-05-30). SECURITY DEFINER count stays
-- at 4: every teacher-profile endpoint is post-authentication and
-- post-tenant, so withTenant() covers all access.

ALTER TABLE teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_profiles FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON teacher_profiles
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
