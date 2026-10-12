-- Admission numbers assigned by SchoolKit (docs/modules/admission-numbers.md).
--
-- The school's choice lives on `schools` (no RLS policy there: it is the
-- tenant table). The running counts live in admission_number_counters, one
-- row per count (scope = year and/or class code, or '' for one count for
-- ever), under FORCE RLS like every tenant table. A number is taken with one
-- INSERT … ON CONFLICT DO UPDATE … RETURNING in the same transaction as the
-- student insert, so concurrent adds never share a number and a rolled-back
-- add uses none. No SECURITY DEFINER function; the count stays 23.

CREATE TYPE "AdmissionNumberMode" AS ENUM ('MANUAL', 'AUTO');
CREATE TYPE "AdmissionNumberOrder" AS ENUM ('SCHOOL', 'CLASS', 'RANDOM');

ALTER TABLE "schools"
  ADD COLUMN "admission_number_mode"       "AdmissionNumberMode"  NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "admission_number_format"     TEXT,
  ADD COLUMN "admission_number_order"      "AdmissionNumberOrder" NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN "admission_number_decided_at" TIMESTAMP(3),
  ADD CONSTRAINT "schools_admission_number_auto_has_format"
    CHECK ("admission_number_mode" = 'MANUAL' OR "admission_number_format" IS NOT NULL),
  ADD CONSTRAINT "schools_admission_number_format_length"
    CHECK ("admission_number_format" IS NULL OR char_length("admission_number_format") BETWEEN 1 AND 60);

CREATE TABLE "admission_number_counters" (
  "school_id"  TEXT NOT NULL,
  "scope"      TEXT NOT NULL,
  "last_value" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admission_number_counters_pkey" PRIMARY KEY ("school_id", "scope"),
  CONSTRAINT "admission_number_counters_last_value_check" CHECK ("last_value" >= 0),
  CONSTRAINT "admission_number_counters_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "admission_number_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admission_number_counters" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admission_number_counters
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
