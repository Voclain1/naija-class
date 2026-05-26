-- Phase 1 / Slice 6 — Import jobs (CSV import bookkeeping).
-- DDL hand-written following the slice-5 guardians migration template;
-- RLS policy block appended verbatim from
-- packages/db/prisma/policies/phase-1.sql (the policy file is the source
-- of truth — keep these in sync).
--
-- One table for all three import types (STUDENTS, GUARDIANS, TEACHERS).
-- Slice 6 only exercises STUDENTS; slices 7 and 8 add the commit path
-- and the guardian + teacher Zod schemas respectively, with no further
-- schema change to this table.
--
-- The state machine lives in the application (imports.service +
-- validate.processor + commit.processor). Postgres-side this is just
-- a row that records where the source CSV lives, what mapping the admin
-- chose, what the validator found, and (slice 7+) what got committed.
--
-- Tenant context for the BullMQ worker is established by
-- apps/api/src/common/queue/tenant-worker.ts before any DB access — the
-- wrapper calls withTenant(job.data.schoolId, ...) for every processor,
-- so RLS protects this table identically whether the writer is a
-- request handler or a worker. SECURITY DEFINER count stays at 4.

-- CreateEnum
CREATE TYPE "ImportJobType" AS ENUM ('STUDENTS', 'GUARDIANS', 'TEACHERS');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'VALIDATING', 'READY', 'COMMITTING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "type" "ImportJobType" NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_file_url" TEXT NOT NULL,
    "column_mapping" JSONB,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "committed_rows" INTEGER NOT NULL DEFAULT 0,
    "error_report_url" TEXT,
    "preview_snapshot" JSONB,
    "failed_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_school_id_idx" ON "import_jobs"("school_id");

-- CreateIndex
CREATE INDEX "import_jobs_school_id_status_idx" ON "import_jobs"("school_id", "status");

-- ---------------------------------------------------------------------
-- Slice 6 RLS policy (verbatim from prisma/policies/phase-1.sql).
-- Same shape as every prior Phase 1 slice: ENABLE + FORCE on the table,
-- then a tenant_isolation policy with USING + WITH CHECK on the
-- school_id column. ImportJob rows are written by request handlers
-- (upload, mapping, delete) and by BullMQ workers (status transitions);
-- both paths go through withTenant() so the GUC is set and the policy
-- both filters reads and rejects cross-tenant inserts.
-- ---------------------------------------------------------------------

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON import_jobs
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
