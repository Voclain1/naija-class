-- Data protection consent records (docs/modules/data-protection.md, 2026-10-25).
--
-- schools: which wording of the school's data-protection confirmation the
-- owner agreed to, and who. ndpr_consent / ndpr_consent_at already exist.
-- guardians: when the parent agreed to the privacy policy and terms, and the
-- wording version. Both nullable: existing rows have no recorded version, and
-- the product asks them to confirm the current one.
--
-- Columns on existing tables only: their RLS policies already cover them, and
-- no SECURITY DEFINER function changes (count stays 23).

ALTER TABLE "schools" ADD COLUMN "ndpr_consent_version" TEXT;
ALTER TABLE "schools" ADD COLUMN "ndpr_consent_by" TEXT;

ALTER TABLE "guardians" ADD COLUMN "portal_consent_at" TIMESTAMP(3);
ALTER TABLE "guardians" ADD COLUMN "portal_consent_version" TEXT;
