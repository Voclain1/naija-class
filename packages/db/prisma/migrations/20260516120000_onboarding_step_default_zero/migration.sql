-- Slice 6 prep — change schools.onboarding_step semantic from "currently on step N"
-- (default 1) to "number of completed steps" (default 0). The Slice 6 wizard endpoint
-- enforces `school.onboarding_step === step - 1` before advancing, so a fresh signup
-- must start at 0, not 1, or POST /schools/me/onboarding/1 would always 409.
--
-- Two statements, in this order:
--   1. ALTER the default for any future INSERT (signups after this migration runs).
--   2. UPDATE every existing school that's still ONBOARDING to 0, so the wizard
--      flow works for them too. This includes the bluebird-academy fixture so the
--      manual test plan exercises the real flow against real data — synthetic
--      fixtures hide bugs that real data finds.
--
-- We deliberately do NOT touch schools where status != 'ONBOARDING'. Those have
-- finished onboarding (status ACTIVE) or are out of scope (SUSPENDED, ARCHIVED);
-- mutating their onboarding_step would be a behaviour change for no benefit.

ALTER TABLE "schools" ALTER COLUMN "onboarding_step" SET DEFAULT 0;

UPDATE "schools"
SET    "onboarding_step" = 0
WHERE  "status" = 'ONBOARDING';
