-- Phase 5 / Slice 1 CP2 — AI core: cost/compliance ledger + budget counter.
--
-- Plan-first: docs/modules/phase-5.md (D1-D10). This migration lands the
-- infrastructure CLAUDE.md's AI hard rules mandate, BEFORE any feature slice
-- makes an LLM call:
--
--   "Every call to claudeClient.messages.create must log to the
--    ai_generations table: model, prompt name + version, input/output
--    tokens, latency, cost estimate, success/error."
--   "Per-school monthly token budget enforced before the call, not after."
--
-- Two tables, deliberately separate:
--
--   ai_generations      the per-call ledger the first rule requires. Append
--                       only, one row per settled call (success OR failure).
--
--   ai_budget_periods   a per-school monthly COUNTER, which is what makes the
--                       second rule enforceable. Not a SUM() over
--                       ai_generations — see the model comment in
--                       schema.prisma for the three independent reasons, the
--                       load-bearing one being that a pre-call check is
--                       fundamentally a RESERVATION and an aggregate cannot
--                       express one.
--
-- NEITHER table needs a SECURITY DEFINER function: there is no pre-tenant
-- access path: every read and write happens inside withTenant() with a known
-- schoolId. The SD inventory count stays at 16 (asserted by
-- apps/api/src/__tests__/security-definer-inventory.spec.ts).
--
-- No RBAC rollup in this migration: CP2 ships zero HTTP surface, so there is
-- no handler to gate yet. PHASE_5_PERMISSIONS is landed REFERENCE-ONLY in
-- packages/types/src/permissions.ts (same convention as
-- PHASE_2_SLICE_1_PERMISSIONS) and is granted to roles by the first feature
-- slice that actually exposes an endpoint.

-- =========================================================================
-- 1. schools — AI cost controls
-- =========================================================================
-- ai_enabled defaults TRUE (AI is a headline feature; a school that never
-- opts in would otherwise silently never see it). It is the per-school kill
-- switch: flipping it false stops every AI feature for that school with no
-- deploy. ai_monthly_token_budget is NULL by default, meaning "use the
-- platform default constant" — so the common case needs no per-school row.

ALTER TABLE "schools"
  ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ai_monthly_token_budget" INTEGER;

-- =========================================================================
-- 2. ai_generations — per-call cost/compliance ledger
-- =========================================================================
-- cost_micro_usd is integer MICRO-US-DOLLARS, NOT kobo. Deliberate documented
-- carve-out from CLAUDE.md's Money hard rule, locked as D2 in
-- docs/modules/phase-5.md — the Money rule governs naira a school TRANSACTS
-- (fees, invoices, payments, payroll); this is vendor telemetry the school
-- never sees and no FinanceService path touches. The rule's actual intent
-- (integers, never Float) is preserved. Full reasoning in schema.prisma.
--
-- Deliberately NOT stored: prompt text and completion text. Those belong in
-- ai_interaction_logs.payload. A cost ledger holding conversation content
-- would bloat the budget aggregate and widen the PII surface the AI hard
-- rules exist to keep narrow.

CREATE TABLE "ai_generations" (
    "id"                 TEXT NOT NULL,
    "school_id"          TEXT NOT NULL,
    "interaction_log_id" TEXT,
    "user_id"            TEXT,
    "model"              TEXT NOT NULL,
    "prompt_name"        TEXT NOT NULL,
    "prompt_version"     TEXT NOT NULL,
    "input_tokens"       INTEGER NOT NULL,
    "output_tokens"      INTEGER NOT NULL,
    "latency_ms"         INTEGER NOT NULL,
    "cost_micro_usd"     INTEGER NOT NULL,
    "priced_at_version"  TEXT NOT NULL,
    "success"            BOOLEAN NOT NULL,
    "error_message"      TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_generations_school_id_idx"
  ON "ai_generations"("school_id");
CREATE INDEX "ai_generations_school_id_created_at_idx"
  ON "ai_generations"("school_id", "created_at");
-- Serves the per-user daily rate-limit COUNT inside the reserve transaction.
CREATE INDEX "ai_generations_school_id_user_id_created_at_idx"
  ON "ai_generations"("school_id", "user_id", "created_at");

-- SET NULL, not CASCADE: the cost ledger must outlive content deletion. It is
-- the record that money was spent, and a retention purge of interaction
-- content must not erase the spend history.
ALTER TABLE "ai_generations"
  ADD CONSTRAINT "ai_generations_interaction_log_id_fkey"
  FOREIGN KEY ("interaction_log_id") REFERENCES "ai_interaction_logs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================================
-- 3. ai_budget_periods — per-school monthly budget counter
-- =========================================================================
-- period_start is DATE, not TIMESTAMP: it is a calendar boundary (first day
-- of the UTC month), not a moment — the same convention CLAUDE.md documents
-- for academic-year/term dates. Avoids the "midnight in which zone?" trap.
--
-- tokens_reserved is the ENFORCEMENT column and is pessimistic (input
-- estimate + max_tokens). tokens_actual is the truth, written at settle.
-- tokens_reserved >= tokens_actual always; they converge as calls settle.

CREATE TABLE "ai_budget_periods" (
    "id"              TEXT NOT NULL,
    "school_id"       TEXT NOT NULL,
    "period_start"    DATE NOT NULL,
    "tokens_reserved" INTEGER NOT NULL DEFAULT 0,
    "tokens_actual"   INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd"  INTEGER NOT NULL DEFAULT 0,
    "call_count"      INTEGER NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_budget_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_budget_periods_school_id_idx"
  ON "ai_budget_periods"("school_id");
-- The (school_id, period_start) uniqueness is what makes the reserve
-- statement's INSERT ... ON CONFLICT DO NOTHING race-free under concurrency.
CREATE UNIQUE INDEX "ai_budget_periods_school_id_period_start_key"
  ON "ai_budget_periods"("school_id", "period_start");

-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here. Same note as
-- 20260718000000_phase_4_slice_6_notification_preferences.

-- =========================================================================
-- 4. RLS — flat school_id policies on both tables
-- =========================================================================
-- Both tables carry their OWN school_id, so this is the cheap direct-column
-- check, NOT an EXISTS-through-a-parent subquery — the same pattern as
-- notification_preferences, mastery_records, and ai_interaction_logs. FORCE
-- so even the migration role (school_kit) cannot bypass it.
--
-- Mirrors packages/db/prisma/policies/phase-5.sql, which is the source of
-- truth for these policies; this migration copies it verbatim.

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
