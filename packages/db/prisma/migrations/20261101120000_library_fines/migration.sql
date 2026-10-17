-- Phase 9 / CP6.2 — library fines and lost books (docs/modules/phase-9.md §14
-- CP6-D3/D4, approved 2026-10-17).
--
-- The school's fine rules (off by default; owner and admin set them), and on
-- each loan: the fine worked out at return or the replacement price at a loss,
-- whether it was waived and why, and when a lost book was marked lost and
-- found. The money itself is a LIBRARY_FINE student charge, raised through
-- StudentChargeService (source "library", the loan's id) — never written here.
--
-- A lost loan is closed, so the one-open-loan-per-copy index now also leaves
-- out lost loans. No SECURITY DEFINER function; the count stays 23.

ALTER TABLE "library_settings"
    ADD COLUMN "fines_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "fine_per_day" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "fine_grace_days" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "fine_cap" INTEGER,
    -- Kobo. ₦0 to ₦10,000 a day; grace up to 30 days; cap ₦0 to ₦1,000,000.
    ADD CONSTRAINT "library_settings_fine_per_day" CHECK ("fine_per_day" BETWEEN 0 AND 1000000),
    ADD CONSTRAINT "library_settings_fine_grace_days" CHECK ("fine_grace_days" BETWEEN 0 AND 30),
    ADD CONSTRAINT "library_settings_fine_cap" CHECK ("fine_cap" IS NULL OR "fine_cap" BETWEEN 0 AND 100000000);

ALTER TABLE "library_loans"
    ADD COLUMN "lost_at" TIMESTAMP(3),
    ADD COLUMN "found_at" TIMESTAMP(3),
    -- Kobo: the fine worked out at return, or the replacement price at a loss.
    -- Null when nothing was owed (staff, fines off, on time, no price).
    ADD COLUMN "fine_amount" INTEGER,
    ADD COLUMN "fine_waived_reason" TEXT,
    ADD COLUMN "fine_waived_by" TEXT,
    ADD CONSTRAINT "library_loans_fine_amount" CHECK ("fine_amount" IS NULL OR "fine_amount" > 0),
    ADD CONSTRAINT "library_loans_fine_waived_reason" CHECK ("fine_waived_reason" IS NULL OR char_length("fine_waived_reason") BETWEEN 1 AND 300),
    -- Closed one way or the other, never both.
    ADD CONSTRAINT "library_loans_returned_or_lost" CHECK ("returned_at" IS NULL OR "lost_at" IS NULL),
    ADD CONSTRAINT "library_loans_found_after_lost" CHECK ("found_at" IS NULL OR "lost_at" IS NOT NULL);

DROP INDEX "library_loans_open_copy_key";
CREATE UNIQUE INDEX "library_loans_open_copy_key" ON "library_loans"("copy_id") WHERE "returned_at" IS NULL AND "lost_at" IS NULL;
