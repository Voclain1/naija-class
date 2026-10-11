-- (school_id, date) index on attendance_records, for whole-school date reads.
--
-- The dashboard reads every attendance row in the school from eight weeks ago
-- to today in one query (the 8-week trend, today's present/absent split and
-- today's marked registers). Its only predicate is a date range plus the RLS
-- policy's school_id = GUC. None of the existing indexes leads with
-- (school_id, date):
--   (school_id, student_id, date)  unique, per-student
--   (school_id, class_arm_id, date) the register query, per-arm
--   (school_id, term_id)            the summary query
--   (school_id)
-- so the read walks every attendance row the school has ever recorded and
-- filters by date. It grows by every register marked (docs/deferred.md, "No
-- [schoolId, date] index for whole-school attendance reads").
--
-- Plain CREATE INDEX: Prisma runs each migration in a transaction, where
-- CONCURRENTLY is not allowed. attendance_records is small at pilot scale.
CREATE INDEX IF NOT EXISTS attendance_records_school_id_date_idx
  ON attendance_records (school_id, date);
