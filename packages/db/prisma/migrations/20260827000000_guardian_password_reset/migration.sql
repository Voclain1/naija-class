-- Guardian portal password recovery (F-06).
--
-- Adds the guardian_password_reset_tokens table, its RLS policy, and the two
-- pre-tenant SECURITY DEFINER lookups the public forgot/reset endpoints need.
--
-- WHY A PARALLEL TABLE RATHER THAN REUSING password_reset_tokens. Two
-- independent reasons, either sufficient alone:
--
--   1. STRUCTURAL. password_reset_tokens.user_id is a NOT NULL FK to users
--      ON DELETE CASCADE. A guardian id cannot go in that column. Reuse would
--      mean making user_id nullable, adding a nullable guardian_id, and
--      enforcing "exactly one is set" in a CHECK — trading a hard,
--      database-enforced invariant on a SECURITY table for a softer one, to
--      save a table.
--
--   2. SECURITY. Separate tables make cross-principal token confusion
--      STRUCTURALLY IMPOSSIBLE rather than conventional. A staff reset token
--      presented to POST /portal/reset-password resolves to nothing, because
--      the guardian resolver below reads only this table. A shared table
--      would require every caller to remember a principal-type check —
--      exactly the trade CLAUDE.md's 2026-08-16 SECURITY DEFINER review
--      refused for the four session resolvers, and for the same reason.
--
-- This mirrors the relationship guardian_sessions has to sessions and
-- guardian_invitations has to invitations. It is the established shape for
-- guardian auth in this codebase, not a new one.

-- =========================================================================
-- 1. Table
-- =========================================================================

CREATE TABLE "guardian_password_reset_tokens" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guardian_password_reset_tokens_token_hash_key"
  ON "guardian_password_reset_tokens"("token_hash");
CREATE INDEX "guardian_password_reset_tokens_school_id_idx"
  ON "guardian_password_reset_tokens"("school_id");
CREATE INDEX "guardian_password_reset_tokens_guardian_id_idx"
  ON "guardian_password_reset_tokens"("guardian_id");

ALTER TABLE "guardian_password_reset_tokens"
  ADD CONSTRAINT "guardian_password_reset_tokens_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "guardian_password_reset_tokens"
  ADD CONSTRAINT "guardian_password_reset_tokens_guardian_id_fkey"
  FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 2. RLS
-- =========================================================================
--
-- Direct school_id column (like guardian_invitations, unlike
-- guardian_sessions) so this is the flat policy, not a join through
-- guardians. FORCE so the table owner is not exempt either.

ALTER TABLE "guardian_password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardian_password_reset_tokens" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guardian_password_reset_tokens
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 3. auth_lookup_guardians_for_password_reset(email)
-- =========================================================================
--
-- WHY SECURITY DEFINER: POST /portal/forgot-password is PUBLIC and carries
-- only an email address. `guardians` is under FORCE ROW LEVEL SECURITY and
-- every policy keys off app.current_school_id — but the school_id is one of
-- the things this lookup is FOR. Same chicken-and-egg as
-- auth_lookup_guardians_for_login.
--
-- MULTI-ROW BY DESIGN, and for a different reason than the login function's.
-- Guardian.email is unique only per school (Decision C), so one address can
-- own portal accounts at several schools. Login disambiguates by verifying
-- the supplied password against each candidate. Forgot-password has NO
-- secret to disambiguate with, so it must not try: it returns every
-- portal-enabled match and the caller issues one token per account, mailing
-- each separately with its school named. That reaches only the inbox owner,
-- who already owns all of those accounts.
--
-- RETURNS: { guardian_id, school_id, school_name }
--
-- DELIBERATELY DOES NOT RETURN password_hash. This is the whole reason it is
-- a separate function from auth_lookup_guardians_for_login rather than a
-- reuse of it — the recovery path has no business ever holding a password
-- hash, exactly as auth_lookup_user_for_password_reset is kept separate from
-- auth_lookup_user_for_login on the staff side. Also omits first/last name,
-- phone and email_verified: nothing in the reset path needs them.
--
-- FILTERS in SQL rather than in the service: password_hash IS NOT NULL. A
-- guardian who was never invited, or whose portal access was revoked by
-- clearing password_hash, must not be able to acquire a password through the
-- recovery path — that would turn forgot-password into an account-activation
-- backdoor around the invitation flow. Enforced here so a future second
-- caller cannot forget it.

CREATE OR REPLACE FUNCTION auth_lookup_guardians_for_password_reset(p_email text)
RETURNS TABLE (guardian_id text, school_id text, school_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.id, g.school_id, s.name
  FROM guardians g
  JOIN schools s ON s.id = g.school_id
  WHERE g.email = p_email
    AND g.password_hash IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION auth_lookup_guardians_for_password_reset(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_guardians_for_password_reset(text) TO app_user;

-- =========================================================================
-- 4. auth_resolve_guardian_password_reset_token(token_hash)
-- =========================================================================
--
-- WHY SECURITY DEFINER: POST /portal/reset-password is PUBLIC and carries
-- only a token. guardian_password_reset_tokens is under FORCE RLS, so the
-- row cannot be read until a school_id is known — and the school_id is what
-- this resolves.
--
-- RETURNS: { reset_id, guardian_id, school_id, expires_at, used_at }
--
-- Liveness is DELIBERATELY NOT filtered in the WHERE clause here, unlike
-- auth_resolve_student_invitation. Both used_at and expires_at are returned
-- so the service can tell the caller WHICH failure occurred — "this link has
-- already been used" and "this link has expired, request a new one" are
-- different, actionable messages, and collapsing them into "invalid" would
-- make a legitimate user retry a dead link. This matches
-- auth_resolve_password_reset_token (staff) exactly. Single-use is still
-- enforced atomically, at the UPDATE, by the service — not by trusting this
-- read.
--
-- DELIBERATELY DOES NOT RETURN: token_hash (the caller already holds it),
-- and — the sharpest omission — the guardian's NAME or EMAIL. This endpoint
-- is public and takes an attacker-supplied token, so returning contact
-- details would turn a leaked or brute-forced token into a disclosure of
-- whose account it belongs to. The reset page says "your password"; the
-- person holding the link knows who they are. Same reasoning recorded for
-- auth_resolve_student_invitation.

CREATE OR REPLACE FUNCTION auth_resolve_guardian_password_reset_token(p_token_hash text)
RETURNS TABLE (
  reset_id    text,
  guardian_id text,
  school_id   text,
  expires_at  timestamp(3),
  used_at     timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.guardian_id, t.school_id, t.expires_at, t.used_at
  FROM guardian_password_reset_tokens t
  WHERE t.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION auth_resolve_guardian_password_reset_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_guardian_password_reset_token(text) TO app_user;
