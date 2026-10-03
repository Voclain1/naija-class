-- Phase 8c / CP6a — report card completeness (docs/modules/phase-8.md §20).
--
-- What the Result Checker (CP6b) must show and today's card lacks, built so
-- the portals and the PDF benefit first. No SECURITY DEFINER function is
-- added or changed (count stays 23). report_cards and schools keep their
-- existing RLS; every new column inherits it.

-- 1. Position — two school settings (D47, D51). The defaults reproduce today
--    exactly: the portals hid position (the old FAMILY_VISIBLE_POSITION =
--    false), the released PDF printed it. Nothing changes until a school
--    chooses, so no backfill.
ALTER TABLE "schools"
  ADD COLUMN "position_visible_to_families" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "position_on_report_card_pdf"  BOOLEAN NOT NULL DEFAULT true;

-- 2. Promotion status (D12, D52) — display only; never touches enrollments.
CREATE TYPE "promotion_status" AS ENUM ('PROMOTED', 'PROMOTED_ON_TRIAL', 'REPEAT', 'GRADUATED');

-- 3. report_cards: the attendance snapshot (§20.2) and the promotion status
--    (§20.3). All nullable: cards built before CP6a have no snapshot, and a
--    NULL renders as "no line", never as zero.
ALTER TABLE "report_cards"
  ADD COLUMN "attendance_days_opened" INTEGER,
  ADD COLUMN "attendance_present"     INTEGER,
  ADD COLUMN "attendance_absent"      INTEGER,
  ADD COLUMN "promotion_status"       "promotion_status";

-- Counts can never be negative, and a student cannot have been present or
-- absent on more days than were counted for them — the CHECK makes the second
-- property hold for the student's own days (present + absent is their marked
-- days, which may differ from the arm's days opened after a mid-term move).
ALTER TABLE "report_cards"
  ADD CONSTRAINT "report_cards_attendance_nonnegative" CHECK (
    ("attendance_days_opened" IS NULL OR "attendance_days_opened" >= 0)
    AND ("attendance_present" IS NULL OR "attendance_present" >= 0)
    AND ("attendance_absent" IS NULL OR "attendance_absent" >= 0)
  );
