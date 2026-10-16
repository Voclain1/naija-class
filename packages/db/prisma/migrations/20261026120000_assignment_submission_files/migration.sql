-- Phase 9 / CP4.2 — file answers (docs/modules/phase-9.md §11 CP4-D5, Q8).
--
-- A student attaches up to three photos or PDFs (F1: typed by their own bytes,
-- at most 10 MB) before handing in. Until then a file is STAGED: it belongs to
-- the student and the collected homework, with no submission. Handing in
-- attaches the staged files to the new attempt, and from then on they are part
-- of it, as final as its text. Stored privately under
-- schools/<school>/submissions/<id>.<ext> and read only through a five-minute
-- link after the reader's access is checked.
--
-- An attempt may now be files alone, so its text may be empty (NULL).
-- Tenant data, RLS forced. No SECURITY DEFINER function; the count stays 23.

ALTER TABLE "assignment_submissions" ALTER COLUMN "body" DROP NOT NULL;
ALTER TABLE "assignment_submissions" DROP CONSTRAINT "assignment_submissions_body_length";
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_body_length"
  CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 20000);

-- CreateTable
CREATE TABLE "assignment_submission_files" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "ext" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_submission_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_submission_files_type" CHECK ("ext" IN ('jpg', 'png', 'webp', 'pdf')),
    CONSTRAINT "assignment_submission_files_size" CHECK ("size" BETWEEN 1 AND 10485760)
);

-- CreateIndex
CREATE INDEX "assignment_submission_files_collection_id_student_id_idx" ON "assignment_submission_files"("collection_id", "student_id");
CREATE INDEX "assignment_submission_files_submission_id_idx" ON "assignment_submission_files"("submission_id");

-- AddForeignKey
ALTER TABLE "assignment_submission_files" ADD CONSTRAINT "assignment_submission_files_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "assignment_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_submission_files" ADD CONSTRAINT "assignment_submission_files_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_submission_files" ADD CONSTRAINT "assignment_submission_files_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "assignment_submission_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_submission_files" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_submission_files
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "assignment_submission_files" TO app_user;
