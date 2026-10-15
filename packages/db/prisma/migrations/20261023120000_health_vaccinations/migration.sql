-- Phase 9 / CP3.2 — vaccination records (docs/modules/phase-9.md §10 CP3-D7).
--
-- One row per dose given, with an optional document (a card photo or a PDF)
-- held as a private object: schools/<school>/health/<id>.<document_ext>, read
-- only through a short-lived signed URL after the reader's access is checked.
-- Withdrawn, never deleted. Tenant data, RLS forced. No new permission
-- (health.read / health.manage) and no SECURITY DEFINER function; the count
-- stays 23.

-- CreateTable
CREATE TABLE "health_vaccinations" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "given_on" DATE NOT NULL,
    "document_ext" TEXT,
    "document_size" INTEGER,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by" TEXT,

    CONSTRAINT "health_vaccinations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_vaccinations_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
    -- The type comes from the file's bytes (F1); size is at most 10 MB, and
    -- the two are set together or not at all.
    CONSTRAINT "health_vaccinations_document" CHECK (
      ("document_ext" IS NULL AND "document_size" IS NULL) OR
      ("document_ext" IN ('jpg', 'png', 'webp', 'pdf') AND "document_size" BETWEEN 1 AND 10485760)
    )
);

-- CreateIndex
CREATE INDEX "health_vaccinations_school_id_student_id_idx" ON "health_vaccinations"("school_id", "student_id");

-- AddForeignKey
ALTER TABLE "health_vaccinations" ADD CONSTRAINT "health_vaccinations_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "health_vaccinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_vaccinations" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON health_vaccinations
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "health_vaccinations" TO app_user;
