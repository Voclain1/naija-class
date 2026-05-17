-- Slice 7 — Invitations lifecycle.
--
-- Two changes bundled in this migration because they ship together with the
-- new endpoints and have no value apart from one another:
--   1. Persist firstName / lastName on the Invitation row. Slice 6 captured
--      them in audit metadata only with an explicit "Slice 7 will revisit"
--      note. Storing them on the row itself lets the public accept page
--      pre-fill the form and keeps audit metadata to ids only.
--   2. A SECURITY DEFINER lookup function that resolves an invitation token
--      hash to its school_id and minimal metadata — the same chicken-and-egg
--      problem auth_resolve_session and auth_lookup_user_for_login solve
--      for /auth/login and the AuthGuard. See header comment on the function
--      below for the full rationale.

-- =========================================================================
-- 1. Schema change
-- =========================================================================

ALTER TABLE "invitations" ADD COLUMN "first_name" TEXT;
ALTER TABLE "invitations" ADD COLUMN "last_name"  TEXT;

-- Both nullable on purpose. Existing rows (Slice 6 onboarding stubs) get
-- NULLs, which is correct: those invitations were never delivered, so
-- pre-fill never mattered for them. New invitations created via
-- POST /users/invite will populate these from the form payload.

-- =========================================================================
-- 2. auth_resolve_invitation_by_token_hash(token_hash)
-- =========================================================================
--
-- Looks up an invitation by token hash so the public accept-page endpoints
-- (GET /invitations/:token and POST /invitations/:token/accept) can validate
-- the token and discover the school_id before withTenant() can apply.
--
-- Why SECURITY DEFINER:
--   `invitations` is under FORCE ROW LEVEL SECURITY (see
--   20260514120001_add_rls_policies). Its policy joins through
--   invitations.school_id against current_setting('app.current_school_id', true).
--   The caller of an accept endpoint has no session yet — they're about to
--   create one — so there is no JWT-derived school_id to plug into the GUC.
--   Without this function, the only options would be (a) drop RLS on
--   `invitations` (security regression), or (b) loop over every tenant
--   attempting withTenant until one returns a row (catastrophic).
--
-- SECURITY DEFINER discipline (mirrors the other three functions in this
-- codebase; see CLAUDE.md → "SECURITY DEFINER functions — index" for the
-- full inventory):
--   1. Owned by the migration role (`school_kit`).
--   2. SET search_path = public, pg_temp — pins resolution against search-
--      path hijacking.
--   3. Returns scalars only — no full row, no PII beyond what the caller
--      already supplied (the email is returned because the accept form
--      shows "Join {school} as admin" with the invitee's email pre-filled).
--   4. PUBLIC revoked, app_user granted EXECUTE only.
--
-- Returns (when row exists):
--   invitation_id  — text id of the invitation (used to claim it atomically
--                    on accept via UPDATE ... WHERE acceptedAt IS NULL)
--   school_id      — text id of the tenant; the caller sets this GUC before
--                    every subsequent tenant-scoped query
--   email          — invitee email (the accept form shows it back to the
--                    user; we never let the user CHANGE it because the
--                    invitation was issued to that address)
--   role_key       — the role being granted on accept (always 'admin' in
--                    Phase 0 but returned so the public GET can label the
--                    page "Join X as admin")
--   first_name     — pre-fill for the accept form (nullable)
--   last_name      — pre-fill for the accept form (nullable)
--   invited_by     — text id of the inviting user; caller scopes to the
--                    invitation's tenant and looks up the inviter's display
--                    name to render "Invited by Jane Doe"
--   expires_at     — timestamp(3); caller compares against NOW() to decide
--                    410 INVITATION_EXPIRED
--   accepted_at    — timestamp(3), nullable; caller short-circuits to 410
--                    INVITATION_ALREADY_ACCEPTED when set
--
-- Returns NO ROWS when:
--   - no invitation matches the token hash (caller maps to 404)
--
-- DELIBERATELY NOT RETURNED:
--   - token_hash — the caller already has the raw token they hashed in;
--     returning the hash would be useless and risk it being logged.
--   - phone — Phase 0 invites are email-only; the column exists for Phase 4
--     but is never set today, so omitting it keeps the contract narrow.
--   - created_at — not needed by either accept endpoint; the pending-invite
--     list (GET /users/invitations) goes through withTenant and reads it
--     directly.

CREATE OR REPLACE FUNCTION auth_resolve_invitation_by_token_hash(p_token_hash text)
RETURNS TABLE(
  invitation_id text,
  school_id     text,
  email         text,
  role_key      text,
  first_name    text,
  last_name     text,
  invited_by    text,
  expires_at    timestamp(3),
  accepted_at   timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    i.id          AS invitation_id,
    i.school_id   AS school_id,
    i.email       AS email,
    i.role_key    AS role_key,
    i.first_name  AS first_name,
    i.last_name   AS last_name,
    i.invited_by  AS invited_by,
    i.expires_at  AS expires_at,
    i.accepted_at AS accepted_at
  FROM invitations i
  WHERE i.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_invitation_by_token_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_invitation_by_token_hash(text) TO app_user;
