-- Phase 9 / CP6b.2 — the hostel visitor log (docs/modules/phase-9.md §15
-- CP6b-D5; owner's answer 3 in §15.8: parents do NOT see it).
--
-- The house master logs who came to see a boarder: the visitor's name and
-- relationship, a phone number if given, when they arrived and when they
-- left. House masters see only the log of hostels they are assigned to; owner
-- and admin see every hostel's. Tenant data, RLS forced. No SECURITY DEFINER
-- function; the count stays 23.

CREATE TABLE "hostel_visits" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "hostel_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "visitor_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT,
    "arrived_at" TIMESTAMP(3) NOT NULL,
    "left_at" TIMESTAMP(3),
    "logged_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hostel_visits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hostel_visits_visitor_name" CHECK (char_length("visitor_name") BETWEEN 1 AND 80),
    CONSTRAINT "hostel_visits_relationship" CHECK (char_length("relationship") BETWEEN 1 AND 40),
    CONSTRAINT "hostel_visits_phone" CHECK ("phone" IS NULL OR char_length("phone") BETWEEN 7 AND 20),
    CONSTRAINT "hostel_visits_left_after_arrived" CHECK ("left_at" IS NULL OR "left_at" >= "arrived_at")
);
CREATE INDEX "hostel_visits_school_id_hostel_id_arrived_at_idx" ON "hostel_visits"("school_id", "hostel_id", "arrived_at");
CREATE INDEX "hostel_visits_school_id_student_id_idx" ON "hostel_visits"("school_id", "student_id");
ALTER TABLE "hostel_visits" ADD CONSTRAINT "hostel_visits_hostel_id_fkey"
  FOREIGN KEY ("hostel_id") REFERENCES "hostels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hostel_visits" ADD CONSTRAINT "hostel_visits_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hostel_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hostel_visits" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hostel_visits
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "hostel_visits" TO app_user;
