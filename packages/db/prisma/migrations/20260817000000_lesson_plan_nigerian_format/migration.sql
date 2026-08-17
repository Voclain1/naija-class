-- Lesson plan v2 — standard Nigerian lesson note format.
--
-- Prompt v1 produced a generic international lesson plan (objectives ->
-- warm-up -> instruction -> practice -> wrap-up). Nigerian teachers write a
-- different document in their scheme books, and it is the one head teachers
-- and inspectors check. Reported from the first pilot generation at Virgo
-- Fidelis, 2026-08-17.
--
-- Purely additive. Five new nullable columns; nothing is dropped, renamed or
-- backfilled:
--
--   * `introduction` and `activities` stay on the table, still populated for
--     pre-v2 rows, and are simply no longer written to. Dropping them would
--     destroy the content of every lesson note written before today for no
--     gain — the restructure does not need the space.
--
--   * `main_content`, `assessment` and `homework` are REUSED as-is to carry
--     the Presentation, Evaluation and Assignment sections. Their names remain
--     accurate for what they hold, so renaming them would have been churn with
--     a data-migration risk attached.
--
-- Every new column is nullable with no default, matching the existing
-- generated-content columns: a row exists from the moment generation is
-- requested, so a failed generation leaves an inspectable record.
--
-- RLS: no policy change needed. `lesson_plans` already carries its FORCE RLS
-- policy keyed on school_id, and a policy governs the ROW, not the column set
-- — new columns inherit it automatically. Verified against the live database
-- after applying rather than assumed.

ALTER TABLE "lesson_plans" ADD COLUMN "behavioural_objectives" TEXT;
ALTER TABLE "lesson_plans" ADD COLUMN "instructional_materials" TEXT;
ALTER TABLE "lesson_plans" ADD COLUMN "previous_knowledge" TEXT;
ALTER TABLE "lesson_plans" ADD COLUMN "reference_materials" TEXT;
ALTER TABLE "lesson_plans" ADD COLUMN "conclusion" TEXT;
