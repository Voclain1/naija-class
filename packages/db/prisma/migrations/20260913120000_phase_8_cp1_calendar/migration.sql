-- Phase 8 / CP1 — Event Calendar: schema, RLS, and the national-events write block.
-- Plan-first: docs/modules/phase-8.md §15 (D21–D30), approved 2026-09-13.
--
-- Three tables. The split is the design (D21):
--   national_events               PLATFORM data — no school_id. The first content
--                                 table in this schema that is not tenant-scoped.
--   school_events                 tenant data, FORCE RLS.
--   school_hidden_national_events tenant data, FORCE RLS.
--
-- Generated with `prisma migrate diff`, then HAND-TRIMMED: the diff also
-- re-emitted long-standing drift that Prisma cannot model (the curriculum HNSW
-- index, the audit_logs partition PK rename, the payments reference unique
-- index, a fee_items index name). None of that belongs to CP1 and none of it is
-- touched here.
--
-- No SECURITY DEFINER function. The SD inventory count stays at 22 (D22).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "NationalEventKind" AS ENUM ('PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY');

CREATE TYPE "SchoolEventCategory" AS ENUM ('HOLIDAY', 'BREAK', 'EXAM_PERIOD', 'MEETING', 'EVENT', 'RESUMPTION', 'OTHER');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE "national_events" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "kind" "NationalEventKind" NOT NULL,
    "date_confirmed" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "national_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "national_events_date_range_check" CHECK ("end_date" >= "start_date"),
    CONSTRAINT "national_events_source_present_check" CHECK (length(btrim("source")) > 0)
);

CREATE TABLE "school_events" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "SchoolEventCategory" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "school_events_date_range_check" CHECK ("end_date" >= "start_date")
);

CREATE TABLE "school_hidden_national_events" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "national_event_id" TEXT NOT NULL,
    "hidden_by" TEXT NOT NULL,
    "hidden_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_hidden_national_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "national_events_key_key" ON "national_events"("key");
CREATE INDEX "national_events_start_date_end_date_idx" ON "national_events"("start_date", "end_date");
CREATE INDEX "school_events_school_id_idx" ON "school_events"("school_id");
CREATE INDEX "school_events_school_id_start_date_end_date_idx" ON "school_events"("school_id", "start_date", "end_date");
CREATE INDEX "school_hidden_national_events_school_id_idx" ON "school_hidden_national_events"("school_id");
CREATE UNIQUE INDEX "school_hidden_national_events_school_id_national_event_id_key" ON "school_hidden_national_events"("school_id", "national_event_id");

ALTER TABLE "school_hidden_national_events" ADD CONSTRAINT "school_hidden_national_events_national_event_id_fkey" FOREIGN KEY ("national_event_id") REFERENCES "national_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — copied verbatim into packages/db/prisma/policies/phase-8.sql, which is
-- the source of truth.
-- ---------------------------------------------------------------------------

ALTER TABLE "national_events"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "national_events"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_events"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_events"                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_hidden_national_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_hidden_national_events" FORCE  ROW LEVEL SECURITY;

-- national_events, defence layer 1 (D22): a SELECT-only policy and NO policy for
-- INSERT, UPDATE or DELETE. Under RLS a command with no applicable permissive
-- policy is denied, so a role subject to RLS (app_user: no SUPERUSER, no
-- BYPASSRLS) cannot write this table by any path — tenant client, basePrisma,
-- or raw SQL. The read is deliberately unconditional: national holidays are the
-- same for every school, and a GUC-less read must work.
CREATE POLICY national_events_read_all ON national_events
  FOR SELECT
  USING (true);

-- national_events, defence layer 2 (D22): remove the write privileges that
-- ALTER DEFAULT PRIVILEGES granted app_user on table creation (arwd, verified on
-- production 2026-09-13 — phase-8.md §15.7). Independent of layer 1: if a write
-- policy is ever added to this table by mistake, app_user still cannot write.
-- TRUNCATE is not revoked because it was never granted (also verified); it is
-- asserted absent by calendar-rls.spec.ts, since TRUNCATE is not subject to RLS.
REVOKE INSERT, UPDATE, DELETE ON "national_events" FROM app_user;

-- The ONLY write path left is a migration, run as the migration role
-- (school_kit: owner, BYPASSRLS on production, SUPERUSER locally). That is the
-- approved trade-off: corrections ship as migrations, and git is the audit
-- trail.

CREATE POLICY tenant_isolation ON school_events
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON school_hidden_national_events
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
