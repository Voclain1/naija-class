-- Auth lookup functions used by /auth/login and the AuthGuard.
--
-- The chicken-and-egg problem solved here:
--   `users` and `sessions` are both under FORCE ROW LEVEL SECURITY (see
--   20260514120001_add_rls_policies). Their policies join through
--   `users.school_id` against `current_setting('app.current_school_id', true)`.
--   But the API does not yet know the school_id at the moment it needs to:
--     - Login: the user supplies an email. We need to find the row that
--       matches before we can know which tenant they belong to.
--     - AuthGuard: the request carries a bearer token whose sha256 hash is
--       in `sessions.token_hash`. Same situation — we cannot scope to a
--       tenant until we have looked the row up.
--   Without these SECURITY DEFINER escape hatches, the only options would
--   be (a) drop RLS on the two tables (security regression), or (b) loop
--   over every tenant attempting `withTenant` until one returns a row
--   (catastrophic).
--
-- SECURITY DEFINER discipline (applies to every function in this category):
--   1. Owned by the migration role (`school_kit`), which has BYPASSRLS via
--      SUPERUSER in dev. The runtime role `app_user` does NOT have BYPASSRLS,
--      so it can only escape RLS by calling one of these named functions.
--   2. `SET search_path = public, pg_temp` — pins resolution so a malicious
--      object cannot be inserted earlier on the path to hijack the function.
--   3. Returns scalars / opaque ids only — never a full row, never password
--      hashes alongside identifying fields beyond what the caller already
--      knows (or supplied).
--   4. EXECUTE granted to `app_user` only; PUBLIC is revoked.
--
-- Inventory of SECURITY DEFINER functions in this codebase is tracked in
-- CLAUDE.md → "SECURITY DEFINER functions — index". Adding a function here
-- requires updating that section in the same PR.
--
-- Column-type note: Prisma's `String @id @default(uuid())` maps to a TEXT
-- column (not a `uuid` column). The function signatures below therefore
-- declare TEXT for id columns to match what the table actually stores;
-- TIMESTAMP(3) (no zone) is Prisma's default for DateTime fields. Mismatch
-- here produces a 42P13 ("return type mismatch") at function creation time.

-- =========================================================================
-- auth_resolve_session(token_hash)
-- =========================================================================
--
-- Looks up a session by token hash and returns the metadata needed for the
-- AuthGuard to make an allow/deny decision and attach context to the request.
--
-- Returns (when row exists):
--   session_id        — text id of the session row (so logout can target it)
--   user_id           — text id of the user that owns the session
--   school_id         — text id of the tenant; the request will set this GUC
--                       before any subsequent tenant-scoped query
--   expires_at        — timestamp(3); guard compares against NOW()
--   user_is_active    — boolean from users.is_active; guard rejects if false
--
-- Returns NO ROWS when:
--   - no session matches the token hash
--   - (note: expired and inactive rows still match — caller decides)
--
-- DELIBERATELY NOT RETURNED:
--   - password_hash — the guard has no reason to see it; if a future caller
--     thinks they need it, they're authenticating, not authorizing, and
--     should call auth_lookup_user_for_login instead.
--   - email / phone / names — guard runs pre-tenant; PII does not belong in
--     a request-attached AuthContext that may be logged.
--   - roles / permissions — those are RLS-scoped via withTenant and re-fetched
--     by handlers that actually need them. Keeping them out of the guard
--     prevents stale-permission bugs (e.g., role revocation that takes effect
--     only after token expiry).

CREATE OR REPLACE FUNCTION auth_resolve_session(p_token_hash text)
RETURNS TABLE(
  session_id     text,
  user_id        text,
  school_id      text,
  expires_at     timestamp(3),
  user_is_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    s.id          AS session_id,
    s.user_id     AS user_id,
    u.school_id   AS school_id,
    s.expires_at  AS expires_at,
    u.is_active   AS user_is_active
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_session(text) TO app_user;


-- =========================================================================
-- auth_lookup_user_for_login(email)
-- =========================================================================
--
-- Looks up a user by email so the login service can verify the password and
-- determine the tenant. Like auth_resolve_session, this runs pre-tenant.
--
-- Returns (when row exists):
--   user_id        — text id of the user (used to mint the session)
--   school_id      — text id of the tenant (used to set the GUC + mint session)
--   password_hash  — argon2id hash; the caller MUST argon2.verify it and
--                    MUST NOT log, return in a response, or persist it
--   is_active      — boolean; caller treats false as INVALID_CREDENTIALS
--                    (no account-state leak)
--
-- Returns NO ROWS when:
--   - no user has that email
--   - the user has no password_hash (e.g., invitation flow before they set
--     a password) — login is impossible by definition; treat as no-such-user
--
-- DELIBERATELY NOT RETURNED:
--   - phone, names, role information — login does not need them, and
--     keeping the surface narrow means a future bug that logs the function
--     result has less to leak.
--   - session rows — sessions are a separate concern and live behind their
--     own SECURITY DEFINER lookup (auth_resolve_session).

CREATE OR REPLACE FUNCTION auth_lookup_user_for_login(p_email text)
RETURNS TABLE(
  user_id       text,
  school_id     text,
  password_hash text,
  is_active     boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    u.id            AS user_id,
    u.school_id     AS school_id,
    u.password_hash AS password_hash,
    u.is_active     AS is_active
  FROM users u
  WHERE u.email = p_email
    AND u.password_hash IS NOT NULL
$$;

REVOKE ALL ON FUNCTION auth_lookup_user_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_for_login(text) TO app_user;
