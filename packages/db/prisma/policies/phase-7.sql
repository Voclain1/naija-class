-- Phase 7 RLS policies. Same discipline as phase-0.sql / phase-1.sql /
-- phase-2.sql / phase-5.sql:
--   1. ENABLE + FORCE so the table owner (school_kit migration role) cannot
--      bypass policies; the runtime app_user has neither SUPERUSER nor BYPASSRLS.
--   2. WITH CHECK on every policy so a buggy service cannot INSERT a row
--      carrying another school's school_id.
--   3. Flat school_id check on every table — all three carry school_id
--      directly, including curriculum_chunks, which denormalises it from its
--      parent document precisely so this check stays flat.
--
-- This file is the SOURCE OF TRUTH for Phase 7 policies. Each CP's migration
-- copies its tables' blocks here verbatim.
--
-- WHY THIS ONE MATTERS BEYOND TIDINESS: a cross-tenant leak in
-- curriculum_chunks would put ANOTHER SCHOOL'S curriculum content inside a
-- teacher's generated lesson plan — a silent, plausible-looking leak that
-- neither party would recognise as a leak. The similarity search is raw SQL
-- (Prisma cannot express pgvector types), which makes it one of the few raw
-- read paths in the app, so CLAUDE.md's raw-SQL rule applies directly: run it
-- inside withTenant() so SET LOCAL app.current_school_id is applied, and carry
-- school_id in the WHERE clause as well. Belt and braces, deliberately.

-- ---------------------------------------------------------------------
-- CP1 — curriculum_documents, curriculum_chunks, embedding_generations.
--
-- No SECURITY DEFINER function for any of them: there is no pre-tenant access
-- path. Every read and write happens inside withTenant() with a known
-- schoolId, unlike the auth-resolver family which must run before a tenant
-- exists. The SD inventory count stays at 22.
-- ---------------------------------------------------------------------

ALTER TABLE "curriculum_documents"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "curriculum_documents"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "curriculum_chunks"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "curriculum_chunks"      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "embedding_generations"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "embedding_generations"  FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON curriculum_documents
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON curriculum_chunks
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON embedding_generations
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
