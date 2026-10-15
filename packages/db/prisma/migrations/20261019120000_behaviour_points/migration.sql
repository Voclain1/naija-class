-- Phase 9 / CP2.1 — behaviour points (docs/modules/phase-9.md §9 CP2-D1).
--
-- The school's own switch lives on `schools` (the tenant table; no RLS
-- policy). Off by default, so nothing changes for a school until it opts in.
--
-- `behaviour_categories` is tenant data, ENABLE + FORCE RLS like
-- `behaviour_records`. A record copies its category's value into `points`
-- when written, so a later change of value never rewrites history.
--
-- Also appends `behaviour.manage` to the admin system role, kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts (BEHAVIOUR_ADMIN_PERMISSIONS). Owner
-- is the wildcard; teacher and bursar get nothing.
-- No SECURITY DEFINER function; the count stays 23.

ALTER TABLE "schools"
  ADD COLUMN "behaviour_points_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "behaviour_categories" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "behaviour_kind" NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behaviour_categories_pkey" PRIMARY KEY ("id"),
    -- A commendation scores 1…10, a concern −10…−1. Never zero: a category
    -- worth nothing is a label, and labels are what the note is for.
    CONSTRAINT "behaviour_categories_points_sign" CHECK (
      ("kind" = 'COMMENDATION' AND "points" BETWEEN 1 AND 10)
      OR ("kind" = 'CONCERN' AND "points" BETWEEN -10 AND -1)
    ),
    CONSTRAINT "behaviour_categories_name_length" CHECK (char_length("name") BETWEEN 1 AND 60)
);

-- CreateIndex
CREATE UNIQUE INDEX "behaviour_categories_school_id_name_key" ON "behaviour_categories"("school_id", "name");

ALTER TABLE "behaviour_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "behaviour_categories" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON behaviour_categories
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "behaviour_categories" TO app_user;

-- AlterTable
ALTER TABLE "behaviour_records"
  ADD COLUMN "category_id" TEXT,
  ADD COLUMN "points" INTEGER,
  -- A record carries points only together with the category they came from.
  ADD CONSTRAINT "behaviour_records_points_with_category"
    CHECK (("category_id" IS NULL) = ("points" IS NULL));

-- AddForeignKey
ALTER TABLE "behaviour_records" ADD CONSTRAINT "behaviour_records_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "behaviour_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["behaviour.manage"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
