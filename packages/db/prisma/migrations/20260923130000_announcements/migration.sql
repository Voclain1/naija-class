-- Announcements (docs/modules/announcements.md).
--
-- Deferred three times as its own feature (phase-4 §8 D2, phase-8 D20/Q4) and
-- built as one here — NOT folded into the calendar, because an event is a date
-- and an announcement is a message.

-- CreateEnum
CREATE TYPE "announcement_audience" AS ENUM ('EVERYONE', 'PARENTS', 'STAFF', 'CLASS');

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "announcement_audience" NOT NULL,
    "class_arm_id" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by" TEXT,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- A class announcement carries a class, and no other audience may. Enforced
-- here rather than only in the DTO: an audience that disagrees with its class
-- would silently reach the wrong people, or nobody.
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_class_matches_audience"
  CHECK (("audience" = 'CLASS') = ("class_arm_id" IS NOT NULL));

-- CreateIndex
CREATE INDEX "announcements_school_id_created_at_idx" ON "announcements"("school_id", "created_at");

-- CreateTable
CREATE TABLE "announcement_reads" (
    "announcement_id" TEXT NOT NULL,
    "principal_type" "principal_type" NOT NULL,
    "principal_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcement_id","principal_type","principal_id")
);

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation — ENABLE + FORCE with WITH CHECK, like every tenant table.
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcements" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON announcements
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- announcement_reads has no school_id of its own: it is reachable only
-- through an announcement, whose policy already scopes it, and the FK is ON
-- DELETE CASCADE. Enabling FORCE RLS with no policy would make it unreadable
-- to the runtime role, so it is deliberately governed by its parent — the
-- same shape student_guardians and other pure join rows use.
GRANT SELECT, INSERT, UPDATE, DELETE ON "announcements" TO app_user;
GRANT SELECT, INSERT, DELETE ON "announcement_reads" TO app_user;

-- Grant the new permissions to the roles that already exist, so a school that
-- signed up yesterday can use this today (same shape as the phase-8 CP1
-- calendar permission backfill).
UPDATE roles
SET permissions = permissions || '["announcement.read","announcement.create"]'::jsonb
WHERE key IN ('owner', 'admin') AND is_system = true
  AND NOT (permissions @> '["announcement.create"]'::jsonb);

UPDATE roles
SET permissions = permissions || '["announcement.read"]'::jsonb
WHERE key IN ('teacher', 'bursar') AND is_system = true
  AND NOT (permissions @> '["announcement.read"]'::jsonb);
