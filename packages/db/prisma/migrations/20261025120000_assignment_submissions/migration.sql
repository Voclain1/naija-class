-- Phase 9 / CP4.1 — assignments: submitted work and marking
-- (docs/modules/phase-9.md §11 CP4-D1..D4, D7).
--
-- "Collect work" is its own record beside a homework item (`assignments`),
-- which gains nothing (B7: the homework model must not grow a submittedAt).
-- One submission row per student per attempt: a submitted attempt is final;
-- a teacher's return opens the next attempt and the old one is kept.
--
-- Tenant data, RLS forced on both. No SECURITY DEFINER function; the count
-- stays 23.

-- CreateTable
CREATE TABLE "assignment_collections" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "total_marks" INTEGER NOT NULL,
    "accepting" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_collections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_collections_total_marks" CHECK ("total_marks" BETWEEN 1 AND 1000)
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "typed_chars" INTEGER NOT NULL DEFAULT 0,
    "pasted_chars" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "mark" INTEGER,
    "feedback" TEXT,
    "marked_by" TEXT,
    "marked_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "returned_by" TEXT,
    "returned_at" TIMESTAMP(3),
    "return_note" TEXT,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assignment_submissions_attempt" CHECK ("attempt" >= 1),
    CONSTRAINT "assignment_submissions_body_length" CHECK (char_length("body") BETWEEN 1 AND 20000),
    CONSTRAINT "assignment_submissions_counts" CHECK ("typed_chars" >= 0 AND "pasted_chars" >= 0),
    CONSTRAINT "assignment_submissions_feedback_length" CHECK ("feedback" IS NULL OR char_length("feedback") BETWEEN 1 AND 2000),
    CONSTRAINT "assignment_submissions_return_note_length" CHECK ("return_note" IS NULL OR char_length("return_note") BETWEEN 1 AND 500),
    -- A mark is a mark with who gave it and when, or nothing at all.
    CONSTRAINT "assignment_submissions_marked" CHECK (
      ("mark" IS NULL AND "marked_by" IS NULL AND "marked_at" IS NULL) OR
      ("mark" >= 0 AND "marked_by" IS NOT NULL AND "marked_at" IS NOT NULL)
    ),
    -- Only a marked attempt is released; a returned attempt is never marked.
    CONSTRAINT "assignment_submissions_released" CHECK ("released_at" IS NULL OR "marked_at" IS NOT NULL),
    CONSTRAINT "assignment_submissions_returned" CHECK (
      ("returned_at" IS NULL AND "returned_by" IS NULL) OR
      ("returned_at" IS NOT NULL AND "returned_by" IS NOT NULL AND "marked_at" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "assignment_collections_assignment_id_key" ON "assignment_collections"("assignment_id");
CREATE UNIQUE INDEX "assignment_submissions_collection_id_student_id_attempt_key" ON "assignment_submissions"("collection_id", "student_id", "attempt");
CREATE INDEX "assignment_submissions_school_id_student_id_idx" ON "assignment_submissions"("school_id", "student_id");

-- AddForeignKey
ALTER TABLE "assignment_collections" ADD CONSTRAINT "assignment_collections_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "assignment_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "assignment_collections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_collections" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_collections
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "assignment_collections" TO app_user;

ALTER TABLE "assignment_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_submissions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assignment_submissions
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "assignment_submissions" TO app_user;

-- The two permissions (CP4-D2): admin and teacher. Owner holds "*". The bursar
-- gets neither. Idempotent, as earlier appends are.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["assignment.read","assignment.mark"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" IN ('admin', 'teacher') AND "is_system" = true;
