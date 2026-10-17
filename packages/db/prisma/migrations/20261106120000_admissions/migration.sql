-- Phase 9 / CP7.1 — online admission applications (docs/modules/phase-9.md
-- §16; owner's answers §16.8, approved 2026-10-17).
--
-- Applications are OPEN BY DEFAULT: a school with no admission_settings row
-- takes applications for every class level, with the default form. The
-- school's own row (written on first save in Settings → Admissions) turns it
-- off, closes classes, shapes the form and says who is told.
--
-- Strangers submit through a public page, so the tables hold a child's and a
-- parent's details before any student or guardian exists. Applicants stay
-- here — never in students — until the school admits them (CP7.2). Rejected
-- and withdrawn applications are deleted, files first, 90 days after closing.
--
-- The optional Admissions officer role (admission.read, admission.manage
-- only) is inserted here; nobody holds it until an admin grants it. Tenant
-- data, RLS forced on every table. The public submission resolves the school
-- by slug through `schools` (no RLS), then writes under the school's GUC: no
-- SECURITY DEFINER function; the count stays 23.

CREATE TYPE "AdmissionStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'OFFERED', 'OFFER_ACCEPTED', 'ADMITTED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "admission_settings" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intro" TEXT,
    "sms_alerts" BOOLEAN NOT NULL DEFAULT true,
    "notify_email" TEXT,
    "offer_letter" TEXT,
    "form" JSONB NOT NULL DEFAULT '{}',
    "closed_class_level_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admission_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admission_settings_intro" CHECK ("intro" IS NULL OR char_length("intro") <= 1000),
    CONSTRAINT "admission_settings_offer_letter" CHECK ("offer_letter" IS NULL OR char_length("offer_letter") <= 5000),
    CONSTRAINT "admission_settings_notify_email" CHECK ("notify_email" IS NULL OR char_length("notify_email") <= 254)
);
CREATE UNIQUE INDEX "admission_settings_school_id_key" ON "admission_settings"("school_id");

CREATE TABLE "admission_applications" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "class_level_id" TEXT NOT NULL,
    "child_first_name" TEXT NOT NULL,
    "child_last_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "guardian_first_name" TEXT NOT NULL,
    "guardian_last_name" TEXT NOT NULL,
    "guardian_relationship" "Relationship" NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "guardian_email" TEXT NOT NULL,
    -- The school's optional fields and own questions, as answered; labels
    -- are copied in so a later edit of the form never changes an answer.
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" "AdmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "consent_version" TEXT NOT NULL,
    -- sha256 of the family's private tracking link; the link itself is only
    -- ever in their email.
    "tracking_token_hash" TEXT NOT NULL,
    "student_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admission_applications_reference" CHECK ("reference" ~ '^APP-[0-9]{4}-[0-9]{4,}$'),
    CONSTRAINT "admission_applications_names" CHECK (
      char_length("child_first_name") BETWEEN 1 AND 60 AND char_length("child_last_name") BETWEEN 1 AND 60
      AND char_length("guardian_first_name") BETWEEN 1 AND 60 AND char_length("guardian_last_name") BETWEEN 1 AND 60),
    CONSTRAINT "admission_applications_guardian_phone" CHECK (char_length("guardian_phone") BETWEEN 7 AND 20),
    CONSTRAINT "admission_applications_guardian_email" CHECK (char_length("guardian_email") BETWEEN 3 AND 254),
    -- Only an admitted application points at a student.
    CONSTRAINT "admission_applications_student" CHECK ("student_id" IS NULL OR "status" = 'ADMITTED')
);
CREATE UNIQUE INDEX "admission_applications_school_id_reference_key" ON "admission_applications"("school_id", "reference");
CREATE UNIQUE INDEX "admission_applications_tracking_token_hash_key" ON "admission_applications"("tracking_token_hash");
CREATE INDEX "admission_applications_school_id_status_idx" ON "admission_applications"("school_id", "status");
CREATE INDEX "admission_applications_school_id_guardian_email_idx" ON "admission_applications"("school_id", "guardian_email");
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_class_level_id_fkey"
  FOREIGN KEY ("class_level_id") REFERENCES "class_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "admission_documents" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    -- PHOTO, BIRTH_CERTIFICATE, LAST_REPORT, CUSTOM_1..CUSTOM_3.
    "slot" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admission_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admission_documents_slot" CHECK ("slot" IN ('PHOTO', 'BIRTH_CERTIFICATE', 'LAST_REPORT', 'CUSTOM_1', 'CUSTOM_2', 'CUSTOM_3')),
    CONSTRAINT "admission_documents_ext" CHECK ("ext" IN ('jpg', 'png', 'webp', 'pdf')),
    CONSTRAINT "admission_documents_size" CHECK ("size_bytes" BETWEEN 1 AND 10485760)
);
CREATE UNIQUE INDEX "admission_documents_application_id_slot_key" ON "admission_documents"("application_id", "slot");
ALTER TABLE "admission_documents" ADD CONSTRAINT "admission_documents_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "admission_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- APP-<year>-<n>, numbered per school per year; row-locked when taken.
CREATE TABLE "admission_reference_counters" (
    "school_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "admission_reference_counters_pkey" PRIMARY KEY ("school_id", "year")
);

-- SMS alerts sent to staff per Lagos day, capped at 30 (§16.8).
CREATE TABLE "admission_sms_counters" (
    "school_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "admission_sms_counters_pkey" PRIMARY KEY ("school_id", "day")
);

ALTER TABLE "admission_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admission_settings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admission_settings
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "admission_settings" TO app_user;

ALTER TABLE "admission_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admission_applications" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admission_applications
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "admission_applications" TO app_user;

ALTER TABLE "admission_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admission_documents" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admission_documents
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "admission_documents" TO app_user;

ALTER TABLE "admission_reference_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admission_reference_counters" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admission_reference_counters
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "admission_reference_counters" TO app_user;

ALTER TABLE "admission_sms_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admission_sms_counters" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admission_sms_counters
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "admission_sms_counters" TO app_user;

-- The optional Admissions officer role (§16.8 answer 1). Granted by an admin
-- to staff who keep their own role. Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts.
INSERT INTO "roles" ("id", "school_id", "key", "name", "description", "is_system", "permissions", "created_at")
SELECT
    gen_random_uuid()::text,
    NULL,
    'admission_officer',
    'Admissions officer',
    'Handles admission applications: reads them and moves them through review, offer and admission. Given by an admin to staff alongside their own role.',
    true,
    '["admission.read","admission.manage"]'::jsonb,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "roles"
    WHERE "school_id" IS NULL AND "key" = 'admission_officer' AND "is_system" = true
);

-- Admin: all three, including admission.settings (the form, the switch and
-- the officers), which an officer does not hold. Owner holds "*". Idempotent.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["admission.read","admission.manage","admission.settings"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
