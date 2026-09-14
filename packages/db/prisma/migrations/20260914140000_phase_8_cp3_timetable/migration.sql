-- Phase 8 / CP3 — Timetable builder: schema, constraints, RLS.
-- Plan-first: docs/modules/phase-8.md §17 (D24–D36), approved 2026-09-14.
--
-- Generated with `prisma migrate diff`, then HAND-TRIMMED of the long-standing
-- drift Prisma cannot model (curriculum HNSW index, audit_logs partition PK
-- rename and index, payments reference unique index, a fee_items index name) —
-- the same trim CP1 recorded. None of that is touched here.
--
-- Hand-added (Prisma cannot express these):
--   * NOT NULL on schools.school_week_days (Prisma emitted the list column
--     nullable even though its type is a non-optional list);
--   * CHECK constraints on times, weekdays and the school week;
--   * the two PARTIAL unique indexes on timetables (§17 D28);
--   * RLS — copied verbatim into policies/phase-8.sql.
--
-- COMPOSITE FOREIGN KEYS (D29). Every reference from a timetable table to a
-- tenant table is on (school_id, id). Postgres foreign-key checks BYPASS
-- row-level security, so a plain FK would accept another school's id; with the
-- school in the key, a cross-tenant reference cannot exist. The supporting
-- UNIQUE (school_id, id) indexes on academic_years, terms, class_arms, subjects
-- and users are always satisfiable because id is already unique.
--
-- No SECURITY DEFINER function. SD count stays at 22.

-- CreateEnum
CREATE TYPE "BellSlotKind" AS ENUM ('LESSON', 'BREAK', 'ASSEMBLY', 'OTHER');

-- AlterTable
ALTER TABLE "schools" ADD COLUMN "school_week_days" SMALLINT[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::SMALLINT[];

-- CreateTable
CREATE TABLE "bell_slots" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "BellSlotKind" NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bell_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetables" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "class_arm_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "term_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timetables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entries" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "timetable_id" TEXT NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "bell_slot_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timetable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_entry_teachers" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,

    CONSTRAINT "timetable_entry_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bell_slots_school_id_idx" ON "bell_slots"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "bell_slots_school_id_id_key" ON "bell_slots"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bell_slots_school_id_position_key" ON "bell_slots"("school_id", "position");

-- CreateIndex
CREATE INDEX "timetables_school_id_idx" ON "timetables"("school_id");

-- CreateIndex
CREATE INDEX "timetables_school_id_academic_year_id_idx" ON "timetables"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetables_school_id_id_key" ON "timetables"("school_id", "id");

-- CreateIndex
CREATE INDEX "timetable_entries_school_id_idx" ON "timetable_entries"("school_id");

-- CreateIndex
CREATE INDEX "timetable_entries_school_id_bell_slot_id_idx" ON "timetable_entries"("school_id", "bell_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_school_id_id_key" ON "timetable_entries"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entries_timetable_id_day_of_week_bell_slot_id_key" ON "timetable_entries"("timetable_id", "day_of_week", "bell_slot_id");

-- CreateIndex
CREATE INDEX "timetable_entry_teachers_school_id_idx" ON "timetable_entry_teachers"("school_id");

-- CreateIndex
CREATE INDEX "timetable_entry_teachers_school_id_teacher_id_idx" ON "timetable_entry_teachers"("school_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_entry_teachers_entry_id_teacher_id_key" ON "timetable_entry_teachers"("entry_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_school_id_id_key" ON "academic_years"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "class_arms_school_id_id_key" ON "class_arms"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_school_id_id_key" ON "subjects"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_school_id_id_key" ON "terms"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "users_school_id_id_key" ON "users"("school_id", "id");

-- AddForeignKey
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_school_id_class_arm_id_fkey" FOREIGN KEY ("school_id", "class_arm_id") REFERENCES "class_arms"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetables" ADD CONSTRAINT "timetables_school_id_term_id_fkey" FOREIGN KEY ("school_id", "term_id") REFERENCES "terms"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_school_id_timetable_id_fkey" FOREIGN KEY ("school_id", "timetable_id") REFERENCES "timetables"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_school_id_bell_slot_id_fkey" FOREIGN KEY ("school_id", "bell_slot_id") REFERENCES "bell_slots"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entry_teachers" ADD CONSTRAINT "timetable_entry_teachers_school_id_entry_id_fkey" FOREIGN KEY ("school_id", "entry_id") REFERENCES "timetable_entries"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_entry_teachers" ADD CONSTRAINT "timetable_entry_teachers_school_id_teacher_id_fkey" FOREIGN KEY ("school_id", "teacher_id") REFERENCES "users"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added constraints
-- ---------------------------------------------------------------------------

-- D27: minutes since midnight, school wall-clock time.
ALTER TABLE "bell_slots" ADD CONSTRAINT "bell_slots_minutes_check"
  CHECK ("start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440);
ALTER TABLE "bell_slots" ADD CONSTRAINT "bell_slots_position_check" CHECK ("position" >= 1);
ALTER TABLE "bell_slots" ADD CONSTRAINT "bell_slots_label_check" CHECK (length(btrim("label")) > 0);

-- ISO weekday: 1 = Monday … 7 = Sunday.
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_day_of_week_check"
  CHECK ("day_of_week" BETWEEN 1 AND 7);

-- D34: a non-empty set of ISO weekdays.
ALTER TABLE "schools" ADD CONSTRAINT "schools_school_week_days_check"
  CHECK (cardinality("school_week_days") BETWEEN 1 AND 7 AND "school_week_days" <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]);

-- D3 / D28: at most ONE year-wide timetable per class per academic year, and at
-- most ONE term timetable per class per term. Partial, because Postgres treats
-- NULLs as distinct in an ordinary unique index (the TeacherAssignment caveat).
CREATE UNIQUE INDEX "timetables_one_year_wide_per_arm_year"
  ON "timetables" ("school_id", "class_arm_id", "academic_year_id") WHERE "term_id" IS NULL;
CREATE UNIQUE INDEX "timetables_one_per_arm_term"
  ON "timetables" ("school_id", "class_arm_id", "term_id") WHERE "term_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS — source of truth: packages/db/prisma/policies/phase-8.sql
-- ---------------------------------------------------------------------------

ALTER TABLE "bell_slots"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bell_slots"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "timetables"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timetables"               FORCE  ROW LEVEL SECURITY;
ALTER TABLE "timetable_entries"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timetable_entries"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "timetable_entry_teachers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timetable_entry_teachers" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON bell_slots
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON timetables
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON timetable_entries
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON timetable_entry_teachers
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
