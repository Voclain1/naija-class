-- Phase 9 / CP6b.3 — exeats, a boarder's leave out (docs/modules/phase-9.md
-- §15 CP6b-D6; owner's answer 5 in §15.8: any linked guardian may ask, naming
-- who will collect).
--
-- A parent asks in the portal or parent app, or the school enters a request
-- taken by phone. The house master approves or refuses (a refusal needs a
-- note) and the parent is told. On the day the house master logs when the
-- child left, and who collected them if not the person named, then when they
-- came back. A child not back by the agreed time shows as late; nothing is
-- sent automatically. The parent may cancel until the child has left.
--
-- REQUESTED → APPROVED or REFUSED → OUT → BACK, or CANCELLED before OUT. Each
-- move is a conditional UPDATE on the current status, so two people acting at
-- once cannot both win. Tenant data, RLS forced. No SECURITY DEFINER function;
-- the count stays 23.

CREATE TYPE "HostelExeatStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REFUSED', 'OUT', 'BACK', 'CANCELLED');

CREATE TABLE "hostel_exeats" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "hostel_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "out_at" TIMESTAMP(3) NOT NULL,
    "back_by" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "collector_name" TEXT NOT NULL,
    "collector_relationship" TEXT NOT NULL,
    "collector_phone" TEXT NOT NULL,
    "status" "HostelExeatStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by_guardian_id" TEXT,
    "requested_by_user_id" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "left_at" TIMESTAMP(3),
    "collected_by" TEXT,
    "back_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hostel_exeats_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hostel_exeats_back_after_out" CHECK ("back_by" > "out_at"),
    CONSTRAINT "hostel_exeats_reason" CHECK (char_length("reason") BETWEEN 1 AND 300),
    CONSTRAINT "hostel_exeats_collector_name" CHECK (char_length("collector_name") BETWEEN 1 AND 80),
    CONSTRAINT "hostel_exeats_collector_relationship" CHECK (char_length("collector_relationship") BETWEEN 1 AND 40),
    CONSTRAINT "hostel_exeats_collector_phone" CHECK (char_length("collector_phone") BETWEEN 7 AND 20),
    CONSTRAINT "hostel_exeats_collected_by" CHECK ("collected_by" IS NULL OR char_length("collected_by") BETWEEN 1 AND 120),
    CONSTRAINT "hostel_exeats_decision_note" CHECK ("decision_note" IS NULL OR char_length("decision_note") BETWEEN 1 AND 300),
    -- Asked by a parent or entered by the school: exactly one.
    CONSTRAINT "hostel_exeats_requested_by" CHECK (("requested_by_guardian_id" IS NULL) <> ("requested_by_user_id" IS NULL)),
    -- A refusal says why.
    CONSTRAINT "hostel_exeats_refusal_note" CHECK ("status" <> 'REFUSED' OR "decision_note" IS NOT NULL)
);
CREATE INDEX "hostel_exeats_school_id_hostel_id_status_idx" ON "hostel_exeats"("school_id", "hostel_id", "status");
CREATE INDEX "hostel_exeats_school_id_student_id_idx" ON "hostel_exeats"("school_id", "student_id");
ALTER TABLE "hostel_exeats" ADD CONSTRAINT "hostel_exeats_hostel_id_fkey"
  FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_exeats" ADD CONSTRAINT "hostel_exeats_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hostel_exeats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hostel_exeats" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hostel_exeats
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "hostel_exeats" TO app_user;
