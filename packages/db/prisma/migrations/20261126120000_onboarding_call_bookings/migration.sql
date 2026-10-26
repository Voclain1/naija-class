-- Setup-call bookings (2026-10-26, docs/modules/onboarding-call.md).
--
-- 1. schools.onboarding_call_prompt_closed_at / onboarding_call_booked_at:
--    the "book a setup call" page shows once after the setup wizard, until
--    the owner books or skips. Every school that already exists is stamped
--    closed, so only schools set up from now on see it. schools has no RLS.
-- 2. onboarding_call_bookings: the booking, tenant-scoped under FORCE RLS
--    like every other school table. The platform admin reads it school by
--    school under each school's own GUC (the schools with
--    onboarding_call_booked_at set), so no SECURITY DEFINER function is
--    needed; the count stays 23.

ALTER TABLE "schools" ADD COLUMN "onboarding_call_prompt_closed_at" TIMESTAMP(3);
ALTER TABLE "schools" ADD COLUMN "onboarding_call_booked_at" TIMESTAMP(3);
UPDATE "schools" SET "onboarding_call_prompt_closed_at" = CURRENT_TIMESTAMP;

CREATE TABLE "onboarding_call_bookings" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "booked_by" TEXT NOT NULL,
    "call_date" DATE NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMP(3),
    CONSTRAINT "onboarding_call_bookings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_call_bookings_start_minute_check" CHECK ("start_minute" >= 0 AND "start_minute" < 1440)
);
CREATE INDEX "onboarding_call_bookings_school_id_created_at_idx" ON "onboarding_call_bookings"("school_id", "created_at");
ALTER TABLE "onboarding_call_bookings" ADD CONSTRAINT "onboarding_call_bookings_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "onboarding_call_bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_call_bookings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_call_bookings"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
