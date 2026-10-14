-- Phase 9 / CP1.1 — report exports (docs/modules/phase-9.md §8).
--
-- report_exports holds one row per PDF copy of a report. The API writes the
-- finished HTML into `html`; the render worker prints it, stores the PDF and
-- sets `html` back to NULL, so a report's rows live here only for the seconds
-- between the two. Rows and files older than 24 hours are deleted daily.
-- FORCE RLS like every tenant table. No SECURITY DEFINER function; the count
-- stays 23.
--
-- Also appends the new `reports.export` permission to the admin system role,
-- kept IN SYNC with packages/db/src/seeds/system-roles.ts (REPORTS_PERMISSIONS).
-- Owner is the wildcard; teacher and bursar get nothing.

CREATE TYPE "ReportExportStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED');

CREATE TABLE "report_exports" (
  "id"           TEXT NOT NULL,
  "school_id"    TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "report"       TEXT NOT NULL,
  "term_id"      TEXT,
  "status"       "ReportExportStatus" NOT NULL DEFAULT 'PENDING',
  "filename"     TEXT NOT NULL,
  "html"         TEXT,
  "storage_path" TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"  TIMESTAMP(3),
  CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_exports_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "report_exports_school_id_created_at_idx" ON "report_exports"("school_id", "created_at");

ALTER TABLE "report_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_exports" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON report_exports
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["reports.export"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
