-- AI and Smart Student Import on for every school (2026-10-25, owner's
-- decision).
--
-- 1. Every existing school gets schools.ai_enabled and
--    schools.smart_import_enabled set to true.
-- 2. Both column defaults become true, so a school created afterwards, by
--    signup, by platform-admin provisioning or by raw SQL, starts with both on.
--    AuthService.signupOwner and PlatformAdminService.createSchool also say so
--    explicitly.
--
-- What still holds:
--    - the per-school monthly token budget;
--    - the platform-wide AI_ENABLED switch;
--    - the teacher-approval gate on every AI output;
--    - each school's own opt-ins (parent_summary_enabled,
--      assignment_feedback_ai_enabled), untouched and still default false;
--    - Smart Import's first-use agreement and checked-rows tick.
-- Either column can be switched off for one school from platform-admin; those
-- toggles keep writing their audit rows. This bulk change writes none: it is a
-- product decision recorded here and in docs/modules/smart-student-import.md.
--
-- schools has no RLS policy (it is the tenant table). No function changes;
-- the SECURITY DEFINER count stays 23.

UPDATE "schools" SET "ai_enabled" = true, "smart_import_enabled" = true;

ALTER TABLE "schools" ALTER COLUMN "ai_enabled" SET DEFAULT true;
ALTER TABLE "schools" ALTER COLUMN "smart_import_enabled" SET DEFAULT true;
