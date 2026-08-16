-- Phase 6 / Slice 3 — Student portal auth.
--
-- Introduces the THIRD authenticated principal in this system (staff User,
-- Guardian, and now Student), the tables it needs, their RLS policies, and
-- three SECURITY DEFINER lookup functions the flow requires pre-tenant.
--
-- Modelled throughout on 20260716000000_phase_4_slice_2_guardian_auth. Read
-- that migration alongside this one: the chicken-and-egg rationale for why
-- session and invitation lookups MUST be SECURITY DEFINER is identical and
-- is not repeated here in full. This header covers only what is specific to
-- students, and specifically what is DIFFERENT.
--
-- =========================================================================
-- SECURITY DEFINER COUNT: 17 -> 20.
-- =========================================================================
-- The slice plan-first (phase-6.md §14, D22) originally anticipated TWO new
-- functions. D26 — approved at review, replacing guardian-typed passwords
-- with a single-use invitation token — adds a third, because a child opening
-- an invitation link has no session and no school context, so resolving that
-- token is a pre-tenant read against a FORCE-RLS table.
--
-- 20 is EXACTLY the cadence-review trigger CLAUDE.md set at the last review
-- ("Next review due at 20"). It is therefore due WITH this migration, not
-- after it. The review is recorded in phase-6.md §14.13 and CLAUDE.md's
-- inventory table, both updated in this same PR — as is
-- apps/api/src/__tests__/security-definer-inventory.spec.ts, which is the
-- standing gate that makes "someone forgot" a CI failure rather than a
-- discovery.
--
-- =========================================================================
-- WHY STUDENTS ARE MODELLED ON GUARDIANS, NOT ON USERS
-- =========================================================================
-- A student gets NO role and NO permissions (phase-6.md D17). Staff RBAC
-- exists to answer "which of the many things in this tenant may this person
-- touch?"; a student has exactly one answer — their own rows — and encoding
-- that as permission strings would create a grant that must be kept in sync
-- while never varying. Guardians have shipped since Phase 4 on precisely
-- this basis, with zero presence in permissions.ts.
--
-- =========================================================================
-- 1. Schema
-- =========================================================================

-- ---- 1a. Student auth columns (phase-6.md D18) --------------------------
-- All nullable, so there is NO BACKFILL: every existing student is already
-- correctly represented as "never activated, never logged in". This is what
-- makes the migration safe to run against live tenant data, which matters
-- because this project has no isolated staging tier (CLAUDE.md).
--
-- Portal state is DERIVED from two of these columns, never stored:
--   never activated -> activated_at NULL, password_hash NULL
--   active          -> activated_at set,  password_hash set
--   deactivated     -> activated_at set,  password_hash NULL
-- A deactivated_at column would be a second, divergeable copy of something
-- audit_logs already records.
ALTER TABLE "students"
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "activated_at"  TIMESTAMP(3),
  ADD COLUMN "last_login_at" TIMESTAMP(3);

-- ---- 1b. student_sessions ----------------------------------------------
-- Mirrors guardian_sessions exactly, INCLUDING the absence of a school_id
-- column. Tenancy resolves by joining through students.school_id, the same
-- shape `sessions` uses through users and guardian_sessions uses through
-- guardians. A third session table with a third tenancy shape would leave
-- the next reader guessing which is correct.
CREATE TABLE "student_sessions" (
    "id"         TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_sessions_token_hash_key" ON "student_sessions"("token_hash");
CREATE INDEX "student_sessions_student_id_idx" ON "student_sessions"("student_id");

ALTER TABLE "student_sessions"
  ADD CONSTRAINT "student_sessions_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- 1c. student_portal_invitations (phase-6.md D26) --------------------
-- The single-use token a GUARDIAN issues so their child can set a password.
--
-- WHY A TOKEN AT ALL, rather than the guardian typing a password for the
-- child: deactivation has to be a real revocation. If the child still holds
-- anything replayable — a link, a code, a screenshot of one — then an "off"
-- switch that merely clears password_hash and deletes sessions is a FALSE
-- SAFETY CONTROL: it tells a parent access is revoked when it is not. So
-- the artefact the child holds is single-use (accepted_at), and
-- deactivation burns any outstanding one (revoked_at).
--
-- Differences from guardian_invitations, each deliberate:
--   - revoked_at EXISTS here. guardian_invitations has no revoke path; here
--     it is the mechanism deactivation uses, so it must be storable.
--   - issued_by is a GUARDIAN id, not a staff User id. A parent invites
--     their own child; school staff are not involved in this flow. Plain
--     scoping column, not a declared FK — same convention as
--     AIGeneration.userId and LessonPlan.createdBy.
--   - No name/email/phone copies, same as guardian_invitations: the subject
--     row already exists.
--
-- school_id is denormalised for direct RLS (same pattern as
-- student_guardians and guardian_invitations).
CREATE TABLE "student_portal_invitations" (
    "id"          TEXT NOT NULL,
    "school_id"   TEXT NOT NULL,
    "student_id"  TEXT NOT NULL,
    "token_hash"  TEXT NOT NULL,
    "issued_by"   TEXT NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at"  TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_portal_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_portal_invitations_token_hash_key"
  ON "student_portal_invitations"("token_hash");
CREATE INDEX "student_portal_invitations_school_id_idx"
  ON "student_portal_invitations"("school_id");
CREATE INDEX "student_portal_invitations_student_id_idx"
  ON "student_portal_invitations"("student_id");

ALTER TABLE "student_portal_invitations"
  ADD CONSTRAINT "student_portal_invitations_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 2. RLS
-- =========================================================================
-- FORCE, not merely ENABLE — the runtime role (app_user) is not the table
-- owner, but FORCE is what makes the policy apply to the owner too, and
-- every other table in this schema is FORCE. Consistency here is load
-- bearing: a table that is merely ENABLEd looks identical in \d output.

ALTER TABLE "student_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_sessions" FORCE ROW LEVEL SECURITY;

ALTER TABLE "student_portal_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_portal_invitations" FORCE ROW LEVEL SECURITY;

-- student_sessions has no school_id column — joined-through-students policy,
-- identical in shape to guardian_sessions' joined-through-guardians policy.
CREATE POLICY tenant_isolation ON student_sessions
  USING (EXISTS (
    SELECT 1 FROM students
    WHERE students.id = student_sessions.student_id
      AND students.school_id::text = current_setting('app.current_school_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM students
    WHERE students.id = student_sessions.student_id
      AND students.school_id::text = current_setting('app.current_school_id', true)
  ));

-- student_portal_invitations has a direct school_id column — flat policy,
-- same shape as guardians / student_guardians / guardian_invitations.
CREATE POLICY tenant_isolation ON student_portal_invitations
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "student_sessions" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "student_portal_invitations" TO app_user;

-- =========================================================================
-- 3. auth_resolve_student_session(token_hash)
-- =========================================================================
--
-- StudentAuthGuard's session lookup. Same chicken-and-egg as
-- auth_resolve_session / auth_resolve_guardian_session: student_sessions is
-- under FORCE RLS and the request carries only a bearer token, so there is
-- no school_id to put in the GUC until after this lookup runs.
--
-- SECURITY DEFINER discipline (CLAUDE.md "SECURITY DEFINER functions"):
--   1. Owned by the migration role (school_kit).
--   2. SET search_path = public, pg_temp.
--   3. Returns scalars only — never a full row.
--   4. EXECUTE revoked from PUBLIC, granted to app_user only.
--
-- RETURNS (at most one row):
--   session_id     — logout target
--   student_id     — subject
--   school_id      — resolved via the join; the request sets this GUC before
--                    any subsequent tenant-scoped query
--   expires_at     — guard compares against NOW()
--   student_status — the SCHOOL's judgement about enrolment
--   portal_enabled — the GUARDIAN's judgement about credentials, expressed
--                    as (password_hash IS NOT NULL)
--
-- WHY BOTH status AND portal_enabled (phase-6.md D23 as amended, D25):
-- they answer different questions and neither subsumes the other. A parent
-- deactivating their child must NOT alter that child's enrolment status, and
-- a school withdrawing a student must not depend on a parent acting. The
-- guard refuses on either. Returning portal_enabled ALSO makes deactivation
-- authoritative at the point of authority rather than the point of cleanup:
-- if the DELETE of session rows somehow did not take effect, a surviving
-- session is still refused on the next request.
--
-- DELIBERATELY NOT RETURNED:
--   - password_hash itself. portal_enabled is a BOOLEAN derived from it; the
--     hash never leaves the database for this caller. The login function
--     below is the only one that returns it.
--   - first/last name, date_of_birth, photo_url, address, phone, email,
--     blood_group, medical_notes, religion, state_of_origin, nationality,
--     admission_number, notes. The guard runs pre-tenant and attaches its
--     result to the request object, where PII does not belong — this row is
--     the most PII-dense in the schema and almost none of it is the guard's
--     business.

CREATE OR REPLACE FUNCTION auth_resolve_student_session(p_token_hash text)
RETURNS TABLE(
  session_id     text,
  student_id     text,
  school_id      text,
  expires_at     timestamp(3),
  student_status text,
  portal_enabled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ss.id                              AS session_id,
    ss.student_id                      AS student_id,
    s.school_id                        AS school_id,
    ss.expires_at                      AS expires_at,
    s.status::text                     AS student_status,
    (s.password_hash IS NOT NULL)      AS portal_enabled
  FROM student_sessions ss
  JOIN students s ON s.id = ss.student_id
  WHERE ss.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_student_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_student_session(text) TO app_user;

-- =========================================================================
-- 4. auth_lookup_student_for_login(school_slug, admission_number)
-- =========================================================================
--
-- The login service's pre-tenant lookup. Both `schools` and `students` must
-- be read before any tenant is known: the caller supplies a school SLUG, not
-- an id, so even the GUC's value is one of the things this resolves.
--
-- SINGLE-ROW BY CONSTRUCTION, and that is the point. schools.slug is
-- globally UNIQUE and students carries UNIQUE(school_id, admission_number),
-- so this returns at most one row for any input.
--
-- CONTRAST WITH auth_lookup_guardians_for_login, which is the inventory's
-- only multi-row function: Guardian.email is unique only PER SCHOOL
-- (Phase 4 Decision C), so the same email legitimately matches guardians at
-- several schools, forcing the portal login service into an argon2-verify
-- loop across candidates and an AMBIGUOUS_GUARDIAN_ACCOUNT error for a
-- guardian who typed everything correctly. That shape is documented as
-- INTERIM in its own migration header. It is deliberately NOT copied here —
-- students cannot reproduce the ambiguity, so the verify-loop must not be
-- inherited along with the resemblance.
--
-- RETURNS (at most one row):
--   student_id, school_id — subject and tenant
--   password_hash         — the login service argon2-verifies against this
--   student_status        — so a WITHDRAWN student is refused at login, not
--                           only at the guard
--   activated_at          — lets the service distinguish "never activated"
--                           from "deactivated" FOR AUDIT ONLY. It must NOT
--                           change the response: every failure returns the
--                           same INVALID_CREDENTIALS, because a divergent
--                           message is exactly the enumeration leak this
--                           surface is most exposed to (phase-6.md §14.2 —
--                           admission numbers are sequential and school
--                           slugs are public, so the username space is
--                           enumerable by construction).
--
-- DELIBERATELY NOT RETURNED:
--   - names, DOB, contact details, medical notes — a login attempt is an
--     UNAUTHENTICATED request. Returning PII here would hand it to anyone
--     who can guess an admission number, which is the whole threat.
--   - the school's name/branding. Nothing pre-auth needs it, and returning
--     it would confirm that a given slug exists.

CREATE OR REPLACE FUNCTION auth_lookup_student_for_login(
  p_school_slug      text,
  p_admission_number text
)
RETURNS TABLE(
  student_id     text,
  school_id      text,
  password_hash  text,
  student_status text,
  activated_at   timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id             AS student_id,
    s.school_id      AS school_id,
    s.password_hash  AS password_hash,
    s.status::text   AS student_status,
    s.activated_at   AS activated_at
  FROM students s
  JOIN schools sc ON sc.id = s.school_id
  WHERE sc.slug = lower(p_school_slug)
    AND s.admission_number = p_admission_number
$$;

REVOKE ALL ON FUNCTION auth_lookup_student_for_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_student_for_login(text, text) TO app_user;

-- =========================================================================
-- 5. auth_resolve_student_invitation(token_hash)
-- =========================================================================
--
-- Resolves a student's single-use portal invitation token, for the two
-- PUBLIC endpoints a child hits before they have any credential at all:
-- GET /student-portal/invitations/:token (render the accept page) and
-- POST /student-portal/invitations/:token/accept (set a password).
--
-- Pre-tenant for exactly the reason auth_resolve_guardian_invitation_by_
-- token_hash is: the child has no session, and the only thing the request
-- carries is the token itself.
--
-- LIVENESS IS EVALUATED IN SQL, NOT IN THE SERVICE. The WHERE clause below
-- requires accepted_at IS NULL AND revoked_at IS NULL. This is deliberate
-- and is the enforcement point for D26's two central guarantees:
--
--   single-use  — once accepted_at is stamped, this function can never
--                 return the row again. A forwarded screenshot of an
--                 already-used link resolves to nothing.
--   burnable    — deactivation stamps revoked_at on every outstanding
--                 invitation, and this function stops returning them in the
--                 same transaction.
--
-- Putting that predicate in the service layer instead would mean a future
-- second caller could forget it, and "the token is single-use" would become
-- a convention rather than a property. Expiry is deliberately NOT in the
-- WHERE clause — expires_at is returned and the caller compares it, matching
-- how every other session/invitation resolver in this schema splits
-- "exists" from "is still valid" so the caller can distinguish EXPIRED from
-- INVALID in its own error copy.
--
-- RETURNS (at most one row):
--   invitation_id, school_id, student_id, expires_at
--
-- DELIBERATELY NOT RETURNED:
--   - token_hash — the caller already holds the token; echoing it back adds
--     nothing and puts it in one more place.
--   - the student's NAME. This is the sharpest omission in this migration
--     and the one most likely to be questioned, so: the accept page would
--     read better as "Set a password for Adaeze" than "Set your password",
--     but this endpoint is PUBLIC and takes an attacker-supplied token. A
--     name here turns a leaked or brute-forced token into a disclosure of
--     which child it belongs to. The page says "your password"; the child
--     knows who they are.
--   - issued_by — the guardian's identity is not the child's business at
--     this step and is available in audit_logs.
--   - accepted_at / revoked_at — never non-NULL in a returned row, by the
--     WHERE clause above.

CREATE OR REPLACE FUNCTION auth_resolve_student_invitation(p_token_hash text)
RETURNS TABLE(
  invitation_id text,
  school_id     text,
  student_id    text,
  expires_at    timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    spi.id         AS invitation_id,
    spi.school_id  AS school_id,
    spi.student_id AS student_id,
    spi.expires_at AS expires_at
  FROM student_portal_invitations spi
  WHERE spi.token_hash = p_token_hash
    AND spi.accepted_at IS NULL
    AND spi.revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION auth_resolve_student_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_student_invitation(text) TO app_user;
