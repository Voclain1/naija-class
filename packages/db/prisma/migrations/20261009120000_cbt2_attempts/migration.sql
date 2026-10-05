-- =========================================================================
-- Online exams (CBT), slice 2 — attempts (docs/modules/cbt.md D5, D6)
-- =========================================================================
--
-- One row per (candidate, lab machine). A student who sat on two machines has
-- two rows, and the results page (CBT3) asks the teacher which one counts
-- (D5); nothing here picks.
--
-- The machine sends a SNAPSHOT of the whole attempt each time (every answer so
-- far, with a sequence number that only goes up), never a diff. The server
-- keeps the snapshot with the highest `seq`, so a batch that arrives twice, or
-- late, or out of order, changes nothing. Two clocks are kept on purpose:
-- `started_at`/`submitted_at` are the MACHINE's (what the student lived), and
-- `first_received_at`/`last_received_at` the SERVER's (when it reached us).
-- Marking and the flags for a late or over-long attempt are CBT3's.
--
-- `answers` is a JSON object { examPaperItemId: questionOptionId }, checked
-- against the frozen paper by the service before it is stored. No answer key
-- here; marking reads it from the paper.
--
-- The candidate FK is RESTRICT: unpublishing deletes the candidate list, and
-- the service refuses that once answers exist (D2); the RESTRICT is the same
-- rule held by the database. Tenant-scoped with the flat school_id policy,
-- FORCE RLS. No SECURITY DEFINER function (count stays 23): the public
-- delivery endpoints resolve the school from its slug (schools has no RLS)
-- and then read and write under that school's GUC.

CREATE TABLE "cbt_attempts" (
  "id"                TEXT NOT NULL,
  "school_id"         TEXT NOT NULL,
  "sitting_id"        TEXT NOT NULL,
  "candidate_id"      TEXT NOT NULL,
  "device_id"         TEXT NOT NULL,
  "seq"               INTEGER NOT NULL,
  "answers"           JSONB NOT NULL DEFAULT '{}',
  "answered_count"    INTEGER NOT NULL DEFAULT 0,
  "started_at"        TIMESTAMP(3) NOT NULL,
  "submitted_at"      TIMESTAMP(3),
  "extra_minutes"     INTEGER NOT NULL DEFAULT 0,
  "focus_losses"      INTEGER NOT NULL DEFAULT 0,
  "first_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_received_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cbt_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cbt_attempts_device_id_check" CHECK ("device_id" ~ '^[0-9a-f-]{36}$'),
  CONSTRAINT "cbt_attempts_seq_check" CHECK ("seq" >= 0),
  CONSTRAINT "cbt_attempts_answered_count_check" CHECK ("answered_count" >= 0),
  CONSTRAINT "cbt_attempts_extra_minutes_check" CHECK ("extra_minutes" BETWEEN 0 AND 600),
  CONSTRAINT "cbt_attempts_focus_losses_check" CHECK ("focus_losses" >= 0),
  CONSTRAINT "cbt_attempts_answers_check" CHECK (jsonb_typeof("answers") = 'object'),
  CONSTRAINT "cbt_attempts_sitting_id_fkey" FOREIGN KEY ("sitting_id") REFERENCES "cbt_sittings"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cbt_attempts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "cbt_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cbt_attempts_candidate_id_device_id_key" ON "cbt_attempts"("candidate_id", "device_id");
CREATE INDEX "cbt_attempts_sitting_id_idx" ON "cbt_attempts"("sitting_id");
CREATE INDEX "cbt_attempts_school_id_idx" ON "cbt_attempts"("school_id");

ALTER TABLE "cbt_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cbt_attempts" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cbt_attempts
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
