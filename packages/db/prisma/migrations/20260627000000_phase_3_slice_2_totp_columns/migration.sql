-- Phase 3 / Slice 2 CP2 — TOTP columns on users
--
-- Three nullable / defaulted columns are added to `users` to support
-- owner two-factor authentication:
--
--   totp_pending_secret  TEXT NULL
--     The TOTP secret generated during setup (POST /auth/2fa/setup) but
--     not yet confirmed. Cleared once the owner verifies the first code
--     (POST /auth/2fa/confirm) or replaced if setup is restarted.
--
--   totp_secret  TEXT NULL
--     The active TOTP secret. NULL while 2FA is disabled. Set from
--     totp_pending_secret on confirm; cleared on disable.
--
--   totp_enabled  BOOLEAN NOT NULL DEFAULT false
--     True only when setup has been confirmed. The login service
--     branches on this flag to issue a 2FA challenge instead of a
--     session. Kept as a separate column (not "totp_secret IS NOT NULL")
--     so the semantic intent is explicit and future schema changes (e.g.
--     backup codes) have a clear anchor.
--
-- Security posture:
--   - TOTP secrets contain no PII and no key material useful without
--     the secret itself. They are treated like password_hash: never
--     returned in list responses, never logged, only surfaced to the
--     owner at enrollment time via POST /auth/2fa/setup.
--   - No RLS change needed — the existing tenant-isolation policy on
--     `users` covers new columns automatically (FORCE ROW LEVEL SECURITY
--     gates row access; column-level restrictions are not required here).
--   - No SECURITY DEFINER function changes — the login service reads
--     totp_enabled via withTenant(schoolId) after the SD function
--     resolves the pre-tenant lookup, so no new pre-tenant access path
--     is introduced. SD count remains 4.

ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false;
