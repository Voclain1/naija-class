-- Phase 9 / CP10.1 — event RSVPs (docs/modules/phase-9.md §19.2, approved
-- 2026-10-18).
--
--   * A school event may ask families to reply: the whole school, or chosen
--     classes (`rsvp_class_arm_ids`, empty = whole school), with an optional
--     reply-by date on or before the event's start, and optionally "how many
--     people will come".
--   * One answer per parent per event (`event_rsvps`), changeable until the
--     reply-by date (or the start date when there is none).
--   * `rsvp_reminded_at`: the one reminder push, the day before the reply-by
--     date, to parents who have not answered.
--
-- No new SECURITY DEFINER function; the count stays 23.

ALTER TABLE "school_events"
  ADD COLUMN "rsvp_open" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rsvp_deadline" DATE,
  ADD COLUMN "rsvp_ask_count" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rsvp_class_arm_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "rsvp_reminded_at" TIMESTAMP(3);
ALTER TABLE "school_events"
  ADD CONSTRAINT "school_events_rsvp_deadline" CHECK ("rsvp_deadline" IS NULL OR "rsvp_deadline" <= "start_date");

CREATE TABLE "event_rsvps" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "attending" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_rsvps_answer" CHECK ("answer" IN ('YES', 'NO', 'MAYBE')),
    CONSTRAINT "event_rsvps_attending" CHECK ("attending" IS NULL OR ("attending" BETWEEN 1 AND 10 AND "answer" <> 'NO'))
);
CREATE UNIQUE INDEX "event_rsvps_event_id_guardian_id_key" ON "event_rsvps"("event_id", "guardian_id");
CREATE INDEX "event_rsvps_school_id_event_id_idx" ON "event_rsvps"("school_id", "event_id");
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "school_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_guardian_id_fkey"
  FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_rsvps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_rsvps" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_rsvps
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "event_rsvps" TO app_user;
