-- Phase 9 / CP6.1 — the library: catalogue and lending (docs/modules/phase-9.md
-- §14 CP6-D1/D2/D8, approved 2026-10-17).
--
-- A book, its physical copies (each with an accession number unique in the
-- school), and loans of a copy to a student OR a member of staff. One open
-- loan per copy, by a partial unique index; the service also locks the copy
-- row while issuing. The school's loan period and limits live in one settings
-- row per school; fines arrive in CP6.2.
--
-- Also the `librarian` system role and four permissions.
--
-- Tenant data, RLS forced on every table. No SECURITY DEFINER function; the
-- count stays 23.

CREATE TYPE "LibraryCopyStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'LOST', 'WITHDRAWN');

CREATE TABLE "library_settings" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "loan_days" INTEGER NOT NULL DEFAULT 14,
    "student_limit" INTEGER NOT NULL DEFAULT 2,
    "staff_limit" INTEGER NOT NULL DEFAULT 5,
    "renewal_limit" INTEGER NOT NULL DEFAULT 2,
    -- The next number "number automatically" hands out when copies are added.
    "next_accession" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "library_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "library_settings_loan_days" CHECK ("loan_days" BETWEEN 1 AND 180),
    CONSTRAINT "library_settings_student_limit" CHECK ("student_limit" BETWEEN 0 AND 20),
    CONSTRAINT "library_settings_staff_limit" CHECK ("staff_limit" BETWEEN 0 AND 50),
    CONSTRAINT "library_settings_renewal_limit" CHECK ("renewal_limit" BETWEEN 0 AND 10),
    CONSTRAINT "library_settings_next_accession" CHECK ("next_accession" >= 1)
);
CREATE UNIQUE INDEX "library_settings_school_id_key" ON "library_settings"("school_id");

CREATE TABLE "library_books" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT,
    "isbn" TEXT,
    "publisher" TEXT,
    "published_year" INTEGER,
    "subject_id" TEXT,
    "shelf_location" TEXT,
    -- Kobo; what a lost copy costs a family (CP6.2). Null: none set.
    "replacement_price" INTEGER,
    "reference_only" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "library_books_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "library_books_title" CHECK (char_length("title") BETWEEN 1 AND 300),
    CONSTRAINT "library_books_authors" CHECK ("authors" IS NULL OR char_length("authors") BETWEEN 1 AND 300),
    -- Digits only (an ISBN-10 may end in X), hyphens removed by the service.
    CONSTRAINT "library_books_isbn" CHECK ("isbn" IS NULL OR "isbn" ~ '^([0-9]{9}[0-9X]|[0-9]{13})$'),
    CONSTRAINT "library_books_publisher" CHECK ("publisher" IS NULL OR char_length("publisher") BETWEEN 1 AND 120),
    CONSTRAINT "library_books_published_year" CHECK ("published_year" IS NULL OR "published_year" BETWEEN 1400 AND 2100),
    CONSTRAINT "library_books_shelf_location" CHECK ("shelf_location" IS NULL OR char_length("shelf_location") BETWEEN 1 AND 60),
    -- ₦0 to ₦1,000,000.
    CONSTRAINT "library_books_replacement_price" CHECK ("replacement_price" IS NULL OR "replacement_price" BETWEEN 0 AND 100000000)
);
CREATE INDEX "library_books_school_id_title_idx" ON "library_books"("school_id", "title");
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "library_book_levels" (
    "school_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    "class_level_id" TEXT NOT NULL,
    CONSTRAINT "library_book_levels_pkey" PRIMARY KEY ("book_id", "class_level_id")
);
CREATE INDEX "library_book_levels_school_id_idx" ON "library_book_levels"("school_id");
ALTER TABLE "library_book_levels" ADD CONSTRAINT "library_book_levels_book_id_fkey"
  FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "library_book_levels" ADD CONSTRAINT "library_book_levels_class_level_id_fkey"
  FOREIGN KEY ("class_level_id") REFERENCES "class_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "library_copies" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "book_id" TEXT NOT NULL,
    -- Upper case, as printed on the label or typed by a barcode scanner.
    "accession_number" TEXT NOT NULL,
    "status" "LibraryCopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "library_copies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "library_copies_accession_number" CHECK (char_length("accession_number") BETWEEN 1 AND 30 AND "accession_number" = upper("accession_number")),
    CONSTRAINT "library_copies_note" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "library_copies_school_id_accession_number_key" ON "library_copies"("school_id", "accession_number");
CREATE INDEX "library_copies_book_id_idx" ON "library_copies"("book_id");
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_book_id_fkey"
  FOREIGN KEY ("book_id") REFERENCES "library_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "library_loans" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "copy_id" TEXT NOT NULL,
    "student_id" TEXT,
    "user_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A calendar date in Lagos: the book is due back by the end of this day.
    "due_on" DATE NOT NULL,
    "renewals" INTEGER NOT NULL DEFAULT 0,
    "returned_at" TIMESTAMP(3),
    "issued_by" TEXT,
    "returned_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "library_loans_pkey" PRIMARY KEY ("id"),
    -- A loan is to a student or to a member of staff, never both or neither.
    CONSTRAINT "library_loans_one_borrower" CHECK (("student_id" IS NULL) <> ("user_id" IS NULL)),
    CONSTRAINT "library_loans_renewals" CHECK ("renewals" >= 0)
);
-- One open loan per copy.
CREATE UNIQUE INDEX "library_loans_open_copy_key" ON "library_loans"("copy_id") WHERE "returned_at" IS NULL;
CREATE INDEX "library_loans_school_id_returned_at_idx" ON "library_loans"("school_id", "returned_at");
CREATE INDEX "library_loans_student_id_idx" ON "library_loans"("student_id");
CREATE INDEX "library_loans_user_id_idx" ON "library_loans"("user_id");
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_copy_id_fkey"
  FOREIGN KEY ("copy_id") REFERENCES "library_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "library_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_settings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_settings
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "library_settings" TO app_user;

ALTER TABLE "library_books" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_books" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_books
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "library_books" TO app_user;

ALTER TABLE "library_book_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_book_levels" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_book_levels
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "library_book_levels" TO app_user;

ALTER TABLE "library_copies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_copies" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_copies
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "library_copies" TO app_user;

ALTER TABLE "library_loans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_loans" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_loans
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "library_loans" TO app_user;

-- The librarian (CP6-D8): read, manage and lend. Not library.settings — the
-- loan rules and, from CP6.2, the fine rules are the owner's and admin's.
-- Kept IN SYNC with packages/db/src/seeds/system-roles.ts.
INSERT INTO "roles" ("id", "school_id", "key", "name", "description", "is_system", "permissions", "created_at")
SELECT
    gen_random_uuid()::text,
    NULL,
    'librarian',
    'Librarian',
    'School librarian — keeps the catalogue and lends books to students and staff. No academic, finance, health, staff or settings access.',
    true,
    '["library.read","library.manage","library.lend"]'::jsonb,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "roles"
    WHERE "school_id" IS NULL AND "key" = 'librarian' AND "is_system" = true
);

-- Admin holds all four. Owner holds "*". Teachers and the bursar get none.
-- Idempotent, as earlier appends are.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["library.read","library.manage","library.lend","library.settings"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
