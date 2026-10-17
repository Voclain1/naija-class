-- Phase 9 / CP6.3 — digital resources (docs/modules/phase-9.md §14 CP6-D7,
-- approved 2026-10-17).
--
-- A PDF (F1: private, typed by its bytes, at most 10 MB, read through a
-- five-minute signed link) or an https link, for one subject and one or more
-- class levels. Students in those levels read it in the app. The librarian,
-- owner and admin may add any; a teacher only for the subjects they teach at
-- those levels, and may remove only their own (the service checks both).
--
-- Two permissions, held by owner (by "*"), admin, the Librarian and teacher:
-- library.resource.read and library.resource.write.
--
-- Tenant data, RLS forced. No SECURITY DEFINER function; the count stays 23.

CREATE TYPE "LibraryResourceKind" AS ENUM ('FILE', 'LINK');

CREATE TABLE "library_resources" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subject_id" TEXT NOT NULL,
    "kind" "LibraryResourceKind" NOT NULL,
    "url" TEXT,
    "file_ext" TEXT,
    "file_size" INTEGER,
    "added_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "library_resources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "library_resources_title" CHECK (char_length("title") BETWEEN 1 AND 200),
    CONSTRAINT "library_resources_description" CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 500),
    -- A link has an https address and no file; a file is a PDF and has no address.
    CONSTRAINT "library_resources_kind" CHECK (
      ("kind" = 'LINK' AND "url" ~ '^https://' AND char_length("url") <= 500 AND "file_ext" IS NULL AND "file_size" IS NULL)
      OR ("kind" = 'FILE' AND "url" IS NULL AND "file_ext" = 'pdf' AND "file_size" BETWEEN 1 AND 10485760)
    )
);
CREATE INDEX "library_resources_school_id_subject_id_idx" ON "library_resources"("school_id", "subject_id");
ALTER TABLE "library_resources" ADD CONSTRAINT "library_resources_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "library_resource_levels" (
    "school_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "class_level_id" TEXT NOT NULL,
    CONSTRAINT "library_resource_levels_pkey" PRIMARY KEY ("resource_id", "class_level_id")
);
CREATE INDEX "library_resource_levels_school_id_class_level_id_idx" ON "library_resource_levels"("school_id", "class_level_id");
ALTER TABLE "library_resource_levels" ADD CONSTRAINT "library_resource_levels_resource_id_fkey"
  FOREIGN KEY ("resource_id") REFERENCES "library_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "library_resource_levels" ADD CONSTRAINT "library_resource_levels_class_level_id_fkey"
  FOREIGN KEY ("class_level_id") REFERENCES "class_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "library_resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_resources" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_resources
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "library_resources" TO app_user;

ALTER TABLE "library_resource_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_resource_levels" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON library_resource_levels
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "library_resource_levels" TO app_user;

-- Kept IN SYNC with packages/db/src/seeds/system-roles.ts. Idempotent.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["library.resource.read","library.resource.write"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" IN ('admin', 'librarian', 'teacher') AND "is_system" = true;
