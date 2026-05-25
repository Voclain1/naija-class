-- Phase 1 / Slice 5 — Guardians + student-guardian links.
-- DDL hand-written following the slice-4 students migration template;
-- RLS policy block appended verbatim from
-- packages/db/prisma/policies/phase-1.sql (the policy file is the source
-- of truth — keep these in sync).
--
-- Two tables, both school-scoped, both under FORCE RLS:
--   - guardians: parent/NOK records. NO unique constraints (phone is
--     deliberately shareable across guardians; see schema.prisma header).
--   - student_guardians: link table with ONE unique on (student_id,
--     guardian_id) so a guardian cannot link to the same student twice.
--     P2002 on this constraint is the only post-RLS uniqueness error
--     this slice can raise — the service maps it to GUARDIAN_ALREADY_LINKED.
--
-- onDelete: Cascade on BOTH FKs of student_guardians — deleting a student
-- or a guardian cleans up the links. Guardian deletion itself is gated
-- by the service to refuse hard-delete while links exist (the cascade is
-- defence in depth, not the primary unlink path).
--
-- SECURITY DEFINER count stays at 4. Every guardian / link endpoint is
-- post-authentication and post-tenant; withTenant() covers all access.

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'UNCLE', 'AUNT', 'GRANDPARENT', 'SIBLING', 'OTHER');

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "occupation" TEXT,
    "employer" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "can_pickup" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guardians_school_id_idx" ON "guardians"("school_id");

-- CreateIndex
CREATE INDEX "guardians_school_id_phone_idx" ON "guardians"("school_id", "phone");

-- CreateIndex
CREATE INDEX "student_guardians_school_id_idx" ON "student_guardians"("school_id");

-- CreateIndex
CREATE INDEX "student_guardians_guardian_id_idx" ON "student_guardians"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_guardians_student_id_guardian_id_key" ON "student_guardians"("student_id", "guardian_id");

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- Slice 5 RLS policy (verbatim from prisma/policies/phase-1.sql).
-- Same shape as every prior Phase 1 slice: ENABLE + FORCE on each table,
-- then a tenant_isolation policy with USING + WITH CHECK on the
-- denormalised school_id column. student_guardians carries its own
-- school_id (not EXISTS-through-parent) for cheaper enforcement and a
-- second-line defence against an arms-length controller writing the link
-- into the wrong tenant.
-- ---------------------------------------------------------------------

ALTER TABLE guardians         ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians         FORCE  ROW LEVEL SECURITY;
ALTER TABLE student_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guardians FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guardians
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON student_guardians
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
