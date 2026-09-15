-- Phase 8 / CP4 — published timetable snapshots (docs/modules/phase-8.md §18 D45).
-- Plan-first approved 2026-09-14 (Q41 decided as Option C).
--
-- Generated with `prisma migrate diff`, then HAND-TRIMMED of the long-standing
-- drift Prisma cannot model (curriculum HNSW index, audit_logs partition PK
-- rename and index, payments reference unique index, a fee_items index name,
-- and the cosmetic school_week_days default representation) — the same trim
-- CP1 and CP3 recorded. None of that is touched here.
--
-- One ordinary tenant table. Families read ONLY this table (D45): a frozen
-- snapshot per (class, term), replaced by Publish and DELETED by Withdraw.
--
-- COMPOSITE FOREIGN KEYS (D29): class and term are referenced on
-- (school_id, id), so a publication can never name another school's class or
-- term — foreign-key checks bypass RLS, the school is part of the key.
--
-- No SECURITY DEFINER function. SD count stays at 22.

-- CreateTable
CREATE TABLE "timetable_publications" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "class_arm_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "grid" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "published_by" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timetable_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timetable_publications_school_id_idx" ON "timetable_publications"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_publications_school_id_class_arm_id_term_id_key" ON "timetable_publications"("school_id", "class_arm_id", "term_id");

-- AddForeignKey
ALTER TABLE "timetable_publications" ADD CONSTRAINT "timetable_publications_school_id_class_arm_id_fkey" FOREIGN KEY ("school_id", "class_arm_id") REFERENCES "class_arms"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_publications" ADD CONSTRAINT "timetable_publications_school_id_term_id_fkey" FOREIGN KEY ("school_id", "term_id") REFERENCES "terms"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-added constraints
-- ---------------------------------------------------------------------------

-- The snapshot is a JSON object carrying the three keys every reader relies on.
ALTER TABLE "timetable_publications" ADD CONSTRAINT "timetable_publications_grid_check"
  CHECK (jsonb_typeof("grid") = 'object' AND "grid" ?& ARRAY['slots', 'days', 'lessons']);
-- sha256 hex.
ALTER TABLE "timetable_publications" ADD CONSTRAINT "timetable_publications_content_hash_check"
  CHECK ("content_hash" ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- RLS — source of truth: packages/db/prisma/policies/phase-8.sql
-- ---------------------------------------------------------------------------

ALTER TABLE "timetable_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timetable_publications" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON timetable_publications
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
