-- Phase 5 RLS policies. Same discipline as phase-0.sql / phase-1.sql /
-- phase-2.sql:
--   1. ENABLE + FORCE so the table owner (school_kit migration role) cannot
--      bypass policies; the runtime app_user has neither SUPERUSER nor BYPASSRLS.
--   2. WITH CHECK on every policy so a buggy service cannot INSERT a row
--      carrying another school's school_id.
--   3. Flat school_id check on every table — both Slice 1 tables carry
--      school_id directly (no EXISTS-through-parent needed).
--
-- This file is the SOURCE OF TRUTH for Phase 5 policies and is built up slice
-- by slice. Each slice's migration copies its tables' blocks here verbatim.
-- Slice 1 CP2 lands the two AI-core tables; later feature slices append their
-- own (e.g. lesson_plans in slice 2).
--
-- NOTE on ai_generations specifically: this table is a COST/COMPLIANCE LEDGER,
-- not a content store, and RLS on it is doing real work beyond tidiness — the
-- per-school monthly budget is derived from tenant-scoped rows, so a tenancy
-- leak here would be a billing leak as well as a privacy one. It is also the
-- table the AI hard rules point at ("every call must log to ai_generations"),
-- which makes it the audit surface if a school ever asks what was spent or
-- generated on its behalf.

-- ---------------------------------------------------------------------
-- Slice 1 CP2 — AI core (ai_generations, ai_budget_periods).
--
-- Neither table has a pre-tenant access path — every read and write happens
-- inside withTenant() with a known schoolId — so NEITHER needs a SECURITY
-- DEFINER function. The SD inventory count stays at 16.
-- ---------------------------------------------------------------------

ALTER TABLE "ai_generations"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_generations"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "ai_budget_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_budget_periods" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ai_generations
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON ai_budget_periods
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- ---------------------------------------------------------------------
-- Slice 2 — lesson_plans.
--
-- Carries its own school_id, so the same cheap flat check. No SECURITY
-- DEFINER function: every access is an authenticated, tenant-scoped request
-- already inside withTenant(). SD count stays at 16.
-- ---------------------------------------------------------------------

ALTER TABLE "lesson_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lesson_plans" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lesson_plans
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
