-- Phase 9 / CP6b.1 — hostels, rooms and beds (docs/modules/phase-9.md §15
-- CP6b-D1 to D4, D9; owner's answers §15.8, approved 2026-10-17).
--
-- A hostel is for boys or girls, has house masters (members of staff), and a
-- fee per term that applies every term and session until changed. Rooms have
-- beds numbered 1..n. A student holds one bed for a term — that is what makes
-- them a boarder — and a bed holds one student a term. Placing a child raises
-- one HOSTEL student charge at the hostel's fee, through StudentChargeService
-- only, never a write here. The room row is locked while placing, so two staff
-- choosing the last bed at once cannot both succeed; the unique indexes are
-- the backstop.
--
-- Also the optional `house_master` system role (hostel.house only), and three
-- permissions. Tenant data, RLS forced on every table. No SECURITY DEFINER
-- function; the count stays 23.

CREATE TYPE "HostelGender" AS ENUM ('BOYS', 'GIRLS');

CREATE TABLE "hostels" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "for_gender" "HostelGender" NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hostels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hostels_name" CHECK (char_length("name") BETWEEN 1 AND 80),
    -- ₦0 (none) to ₦10,000,000, the student-charge ceiling.
    CONSTRAINT "hostels_fee" CHECK ("fee" BETWEEN 0 AND 1000000000)
);
CREATE UNIQUE INDEX "hostels_school_id_name_key" ON "hostels"("school_id", "name");

CREATE TABLE "hostel_house_masters" (
    "school_id" TEXT NOT NULL,
    "hostel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hostel_house_masters_pkey" PRIMARY KEY ("hostel_id", "user_id")
);
CREATE INDEX "hostel_house_masters_school_id_user_id_idx" ON "hostel_house_masters"("school_id", "user_id");
ALTER TABLE "hostel_house_masters" ADD CONSTRAINT "hostel_house_masters_hostel_id_fkey"
  FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hostel_house_masters" ADD CONSTRAINT "hostel_house_masters_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hostel_rooms" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "hostel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "beds" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hostel_rooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hostel_rooms_name" CHECK (char_length("name") BETWEEN 1 AND 60),
    CONSTRAINT "hostel_rooms_beds" CHECK ("beds" BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX "hostel_rooms_hostel_id_name_key" ON "hostel_rooms"("hostel_id", "name");
CREATE INDEX "hostel_rooms_school_id_idx" ON "hostel_rooms"("school_id");
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_hostel_id_fkey"
  FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hostel_beds" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "hostel_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "bed_number" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hostel_beds_pkey" PRIMARY KEY ("id"),
    -- The upper bound is the room's bed count, checked with the room locked.
    CONSTRAINT "hostel_beds_bed_number" CHECK ("bed_number" >= 1)
);
-- One bed per student per term; one student per bed per term.
CREATE UNIQUE INDEX "hostel_beds_student_id_term_id_key" ON "hostel_beds"("student_id", "term_id");
CREATE UNIQUE INDEX "hostel_beds_room_id_term_id_bed_number_key" ON "hostel_beds"("room_id", "term_id", "bed_number");
CREATE INDEX "hostel_beds_school_id_hostel_id_term_id_idx" ON "hostel_beds"("school_id", "hostel_id", "term_id");
ALTER TABLE "hostel_beds" ADD CONSTRAINT "hostel_beds_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hostel_beds" ADD CONSTRAINT "hostel_beds_hostel_id_fkey"
  FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_beds" ADD CONSTRAINT "hostel_beds_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "hostel_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "hostels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hostels" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hostels
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "hostels" TO app_user;

ALTER TABLE "hostel_house_masters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hostel_house_masters" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hostel_house_masters
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "hostel_house_masters" TO app_user;

ALTER TABLE "hostel_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hostel_rooms" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hostel_rooms
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "hostel_rooms" TO app_user;

ALTER TABLE "hostel_beds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hostel_beds" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hostel_beds
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "hostel_beds" TO app_user;

-- The optional House master role (§15.8): boarding staff who are not
-- teachers. hostel.house only; the service scopes it to the hostels the person
-- is assigned to. Kept IN SYNC with packages/db/src/seeds/system-roles.ts.
INSERT INTO "roles" ("id", "school_id", "key", "name", "description", "is_system", "permissions", "created_at")
SELECT
    gen_random_uuid()::text,
    NULL,
    'house_master',
    'House master',
    'Boarding house master — sees the boarders of the hostels they are assigned to, keeps the visitor log and decides leave-out requests. No academic, finance, health, staff or settings access.',
    true,
    '["hostel.house"]'::jsonb,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1 FROM "roles"
    WHERE "school_id" IS NULL AND "key" = 'house_master' AND "is_system" = true
);

-- Admin: all three. Bursar: read. Teacher: hostel.house (a teacher may be made
-- a house master without changing role). Owner holds "*". Idempotent.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["hostel.read","hostel.manage","hostel.house"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["hostel.read"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'bursar' AND "is_system" = true;
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["hostel.house"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'teacher' AND "is_system" = true;
