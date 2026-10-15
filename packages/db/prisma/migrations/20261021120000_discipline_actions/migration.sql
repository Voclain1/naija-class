-- Phase 9 / CP2.3 — discipline actions and parent notices
-- (docs/modules/phase-9.md §9 CP2-D3, CP2-D4).
--
-- A teacher proposes an action, an owner or admin decides it, and it can be
-- withdrawn but never deleted. An approved suspension or exclusion notifies
-- every linked guardian once: `discipline_notices` is UNIQUE on (action,
-- guardian, kind), so a retry or a second click cannot send twice.
--
-- Both tables are tenant data, ENABLE + FORCE RLS like `behaviour_records`.
-- No SECURITY DEFINER function: every read happens after the tenant is known,
-- including the parent's (the portal guard resolves the school first). The
-- count stays 23.

-- CreateEnum
CREATE TYPE "discipline_action_type" AS ENUM ('WARNING', 'DETENTION', 'SUSPENSION', 'EXCLUSION');

-- CreateEnum
CREATE TYPE "discipline_action_status" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "discipline_notice_kind" AS ENUM ('SENT', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "discipline_actions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "record_id" TEXT,
    "incident_id" TEXT,
    "type" "discipline_action_type" NOT NULL,
    "start_on" DATE,
    "end_on" DATE,
    "reason" TEXT NOT NULL,
    "status" "discipline_action_status" NOT NULL DEFAULT 'PROPOSED',
    "proposed_by" TEXT NOT NULL,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "withdrawn_by" TEXT,
    "withdrawn_at" TIMESTAMP(3),

    CONSTRAINT "discipline_actions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discipline_actions_reason_length" CHECK (char_length("reason") BETWEEN 1 AND 1000),
    -- The dates follow the type: a warning has none; a detention one day; a
    -- suspension a first and last day, the last not before the first; an
    -- exclusion a first day only.
    CONSTRAINT "discipline_actions_dates_match_type" CHECK (
      ("type" = 'WARNING'    AND "start_on" IS NULL     AND "end_on" IS NULL) OR
      ("type" = 'DETENTION'  AND "start_on" IS NOT NULL AND "end_on" IS NULL) OR
      ("type" = 'SUSPENSION' AND "start_on" IS NOT NULL AND "end_on" IS NOT NULL AND "end_on" >= "start_on") OR
      ("type" = 'EXCLUSION'  AND "start_on" IS NOT NULL AND "end_on" IS NULL)
    ),
    -- A decision is only ever recorded with its decider, and a rejection
    -- always carries a reason.
    CONSTRAINT "discipline_actions_decision_complete" CHECK (
      ("decided_at" IS NULL) = ("decided_by" IS NULL) AND
      ("status" <> 'REJECTED' OR "decision_reason" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "discipline_notices" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "kind" "discipline_notice_kind" NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discipline_notices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discipline_notices_channel" CHECK ("channel" IN ('PUSH', 'SMS', 'NONE'))
);

-- CreateIndex
CREATE INDEX "discipline_actions_school_id_student_id_idx" ON "discipline_actions"("school_id", "student_id");

-- CreateIndex
CREATE INDEX "discipline_actions_school_id_status_idx" ON "discipline_actions"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "discipline_notices_action_id_guardian_id_kind_key" ON "discipline_notices"("action_id", "guardian_id", "kind");

-- AddForeignKey
ALTER TABLE "discipline_notices" ADD CONSTRAINT "discipline_notices_action_id_fkey"
  FOREIGN KEY ("action_id") REFERENCES "discipline_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "discipline_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discipline_actions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discipline_actions
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "discipline_actions" TO app_user;

ALTER TABLE "discipline_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discipline_notices" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discipline_notices
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "discipline_notices" TO app_user;

-- `behaviour.decide` (CP2-D5): approve and reject. Appended to the admin
-- system role, kept IN SYNC with packages/db/src/seeds/system-roles.ts
-- (BEHAVIOUR_ADMIN_PERMISSIONS). Owner is the wildcard; teacher and bursar
-- never hold it.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["behaviour.decide"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
