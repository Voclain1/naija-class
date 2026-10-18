-- Phase 9 / CP7.2 — review, assessment, offer and admitting
-- (docs/modules/phase-9.md §16.8, approved 2026-10-17).
--
-- An application gains:
--   - one ASSESSMENT (entrance exam, interview, online assessment or other),
--     with its time and the school's note, emailed to the family;
--   - the OFFER LETTER the family saw, in full, and when it was offered;
--   - the ACCEPTANCE: when, and which member of staff recorded it (NULL
--     means the family accepted on their tracking page);
--   - the school's optional note to the family when it is not successful;
--   - when it was admitted, and by whom.
--
-- The CHECKs hold the rule the owner set (§16.8 answer 2): an offer always
-- carries its letter, and an accepted offer always carries when it was
-- accepted. No new table, no SECURITY DEFINER function; the count stays 23.
--
-- `admission.admit` (owner and admin): ADMIT creates the student, so an
-- Admissions officer handles applications up to an accepted offer and the
-- admin clears the child into a class (§16.8, "until cleared by admin").

ALTER TABLE "admission_applications"
  ADD COLUMN "assessment_kind" TEXT,
  ADD COLUMN "assessment_at" TIMESTAMP(3),
  ADD COLUMN "assessment_note" TEXT,
  ADD COLUMN "offer_letter" TEXT,
  ADD COLUMN "offered_at" TIMESTAMP(3),
  ADD COLUMN "accepted_at" TIMESTAMP(3),
  ADD COLUMN "accepted_by_user_id" TEXT,
  ADD COLUMN "decision_note" TEXT,
  ADD COLUMN "admitted_at" TIMESTAMP(3),
  ADD COLUMN "admitted_by_user_id" TEXT;

ALTER TABLE "admission_applications"
  ADD CONSTRAINT "admission_applications_assessment" CHECK (
    ("assessment_kind" IS NULL AND "assessment_at" IS NULL AND "assessment_note" IS NULL)
    OR ("assessment_kind" IN ('ENTRANCE_EXAM', 'INTERVIEW', 'ONLINE', 'OTHER') AND "assessment_at" IS NOT NULL)),
  ADD CONSTRAINT "admission_applications_assessment_note" CHECK ("assessment_note" IS NULL OR char_length("assessment_note") <= 1000),
  ADD CONSTRAINT "admission_applications_offer_letter" CHECK ("offer_letter" IS NULL OR char_length("offer_letter") BETWEEN 1 AND 5000),
  ADD CONSTRAINT "admission_applications_decision_note" CHECK ("decision_note" IS NULL OR char_length("decision_note") <= 1000),
  -- An offer is never made without its letter.
  ADD CONSTRAINT "admission_applications_offered" CHECK (
    "status" NOT IN ('OFFERED', 'OFFER_ACCEPTED') OR ("offer_letter" IS NOT NULL AND "offered_at" IS NOT NULL)),
  -- An accepted offer always says when.
  ADD CONSTRAINT "admission_applications_accepted" CHECK ("status" <> 'OFFER_ACCEPTED' OR "accepted_at" IS NOT NULL);

-- Admin gains admission.admit. Owner holds "*". Idempotent; kept in sync with
-- packages/db/src/seeds/system-roles.ts.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["admission.admit"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
