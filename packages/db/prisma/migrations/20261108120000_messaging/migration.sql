-- Phase 9 / CP8.1 — private messaging between families and the school
-- (docs/modules/phase-9.md §17; owner's answers §17.8, approved 2026-10-18).
--
-- This deliberately reverses D11 (the-school-day.md) in part: a parent writes
-- to ONE recipient they choose, about one of their children or in general:
--   CLASS_TEACHER  the child's form teacher (JSS, SSS) or class teacher
--                  (nursery, primary): the arm's class_teacher_id this term;
--   BURSAR         every holder of the bursar role;
--   PRINCIPAL      the appointed principal(s);
--   HEAD_TEACHER   the appointed head teacher(s);
--   ADMIN          the owner and admins;
--   OFFICE         the Inbox officers, or the owner and admins if none.
-- ONLY those recipients see the conversation, plus anyone it is passed to
-- (message_passes) and anyone who has written in it. Students never take
-- part. The school office may start a conversation with one parent.
--
-- Tenant data, RLS forced on every table. No SECURITY DEFINER function; the
-- count stays 23. Three new optional system roles, held by nobody until an
-- admin appoints them: principal, head_teacher, inbox_officer.

CREATE TYPE "MessageRecipient" AS ENUM ('CLASS_TEACHER', 'BURSAR', 'PRINCIPAL', 'HEAD_TEACHER', 'ADMIN', 'OFFICE');

CREATE TABLE "message_threads" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "student_id" TEXT,
    "recipient" "MessageRecipient" NOT NULL,
    -- The class teacher addressed, for CLASS_TEACHER only, fixed at the start.
    "recipient_user_id" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    -- NULL: the guardian started it. Otherwise the office member who did.
    "started_by_user_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_by" TEXT NOT NULL,
    "handled_by_user_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_threads_subject" CHECK (char_length("subject") BETWEEN 1 AND 120),
    CONSTRAINT "message_threads_status" CHECK ("status" IN ('OPEN', 'CLOSED')),
    CONSTRAINT "message_threads_closed" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL)),
    CONSTRAINT "message_threads_last_by" CHECK ("last_message_by" IN ('GUARDIAN', 'STAFF')),
    CONSTRAINT "message_threads_class_teacher" CHECK (("recipient" = 'CLASS_TEACHER') = ("recipient_user_id" IS NOT NULL)),
    CONSTRAINT "message_threads_class_teacher_child" CHECK ("recipient" <> 'CLASS_TEACHER' OR "student_id" IS NOT NULL)
);
CREATE INDEX "message_threads_school_id_status_last_message_at_idx" ON "message_threads"("school_id", "status", "last_message_at");
CREATE INDEX "message_threads_school_id_guardian_id_idx" ON "message_threads"("school_id", "guardian_id");
CREATE INDEX "message_threads_school_id_recipient_idx" ON "message_threads"("school_id", "recipient");
CREATE INDEX "message_threads_recipient_user_id_idx" ON "message_threads"("recipient_user_id");
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_guardian_id_fkey"
  FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A conversation passed on to another recipient ("a fee question to the
-- bursar"). The new recipients see all of it; the one who passed keeps it.
CREATE TABLE "message_passes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "recipient" "MessageRecipient" NOT NULL,
    "recipient_user_id" TEXT,
    "passed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_passes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_passes_class_teacher" CHECK (("recipient" = 'CLASS_TEACHER') = ("recipient_user_id" IS NOT NULL))
);
CREATE INDEX "message_passes_thread_id_idx" ON "message_passes"("thread_id");
CREATE INDEX "message_passes_school_id_recipient_idx" ON "message_passes"("school_id", "recipient");
ALTER TABLE "message_passes" ADD CONSTRAINT "message_passes_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "author_kind" TEXT NOT NULL,
    "guardian_id" TEXT,
    "user_id" TEXT,
    -- For a staff message: which recipient the writer answered as, so the
    -- family sees "Mrs Okafor, Form teacher" or "<School> office".
    "as_recipient" "MessageRecipient",
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_body" CHECK (char_length("body") BETWEEN 1 AND 2000),
    CONSTRAINT "messages_author" CHECK (
      ("author_kind" = 'GUARDIAN' AND "guardian_id" IS NOT NULL AND "user_id" IS NULL AND "as_recipient" IS NULL)
      OR ("author_kind" = 'STAFF' AND "user_id" IS NOT NULL AND "guardian_id" IS NULL AND "as_recipient" IS NOT NULL))
);
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at");
CREATE INDEX "messages_school_id_guardian_id_created_at_idx" ON "messages"("school_id", "guardian_id", "created_at");
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Read state for messages only (announcements keep A5): one row per reader
-- per conversation. "Seen" for the family is any staff row at or after their
-- last message.
CREATE TABLE "message_reads" (
    "school_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "reader_kind" TEXT NOT NULL,
    "reader_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "message_reads_pkey" PRIMARY KEY ("thread_id", "reader_kind", "reader_id"),
    CONSTRAINT "message_reads_kind" CHECK ("reader_kind" IN ('GUARDIAN', 'STAFF'))
);
ALTER TABLE "message_reads" ADD CONSTRAINT "message_reads_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SMS "you have a reply" alerts per Lagos day, capped at 50 (§17.2 CP8-D6).
CREATE TABLE "message_sms_counters" (
    "school_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "message_sms_counters_pkey" PRIMARY KEY ("school_id", "day")
);

ALTER TABLE "message_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_threads" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_threads
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_threads" TO app_user;

ALTER TABLE "message_passes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_passes" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_passes
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_passes" TO app_user;

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO app_user;

ALTER TABLE "message_reads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_reads" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_reads
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_reads" TO app_user;

ALTER TABLE "message_sms_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_sms_counters" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_sms_counters
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_sms_counters" TO app_user;

-- The three appointed roles (§17.8). Kept IN SYNC with
-- packages/db/src/seeds/system-roles.ts. Idempotent.
INSERT INTO "roles" ("id", "school_id", "key", "name", "description", "is_system", "permissions", "created_at")
SELECT gen_random_uuid()::text, NULL, v.key, v.name, v.description, true, v.permissions::jsonb, CURRENT_TIMESTAMP
FROM (VALUES
  ('principal', 'Principal', 'Receives and answers messages parents send to the principal (JSS and SSS). Appointed by an admin, alongside the person''s own role.', '["messages.read","messages.reply"]'),
  ('head_teacher', 'Head teacher', 'Receives and answers messages parents send to the head teacher (nursery and primary). Appointed by an admin, alongside the person''s own role.', '["messages.read","messages.reply"]'),
  ('inbox_officer', 'Inbox officer', 'Answers messages parents send to the school office, and may start a conversation with a parent. Appointed by an admin, alongside the person''s own role.', '["messages.read","messages.reply","messages.start"]')
) AS v(key, name, description, permissions)
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."school_id" IS NULL AND r."key" = v.key AND r."is_system" = true);

-- Admin: read, reply, start and the settings; teachers and bursars read and
-- reply (to what is addressed to them). Owner holds "*". Idempotent.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["messages.read","messages.reply","messages.start","messages.settings"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["messages.read","messages.reply"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" IN ('teacher', 'bursar') AND "is_system" = true;
