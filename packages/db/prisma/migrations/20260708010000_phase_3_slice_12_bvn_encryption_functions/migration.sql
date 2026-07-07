-- Phase 3 / Slice 12 — BVN encryption: encrypt_bvn / decrypt_bvn
--
-- SECURITY DEFINER discipline (see CLAUDE.md "SECURITY DEFINER functions —
-- index" and the header comment in 20260516000000_add_auth_lookup_functions):
--   1. Owned by the migration role (school_kit); PUBLIC revoked, app_user granted.
--   2. SET search_path = public, pg_temp pinned.
--   3. Returns scalars only — never a row, never PII beyond what the caller supplied.
--   4. This header documents why + what's returned + what's deliberately omitted.
--
-- WHY these two functions exist: the BVN encryption key (BVN_ENCRYPTION_KEY,
-- a Fly secret) is delivered per-transaction via `SET LOCAL app.bvn_key`
-- (mirrors app.current_school_id — see tenant-client.ts), and the raw
-- pgcrypto primitives (pgp_sym_encrypt/pgp_sym_decrypt) have EXECUTE revoked
-- from PUBLIC below. That narrows "what can produce/consume BVN ciphertext"
-- to exactly these two reviewed functions, instead of every app_user SQL
-- statement being able to call the crypto primitives directly.
--
-- These are pure crypto primitives, NOT data-access functions — deliberately
-- no school_id/user_id parameters. Row selection and the UPDATE/SELECT
-- against `users` stays ordinary app_user SQL inside withTenant, so RLS still
-- governs which row can be written or read; the SECURITY DEFINER wrapper's
-- only job is to be the sole caller of the raw pgcrypto functions.
--
-- encrypt_bvn(plaintext) returns bytea ciphertext. Deliberately NOT returned:
--   nothing else — there is no row here, only a transform of the input the
--   caller already possesses.
-- decrypt_bvn(ciphertext) returns the plaintext BVN. Deliberately NOT
--   returned: anything beyond the single decrypted string — the caller
--   (BvnService.revealBvn) is responsible for auditing every call and never
--   logging the return value. This is the one SECURITY DEFINER function in
--   the inventory whose whole purpose is to hand back sensitive plaintext;
--   the audit obligation lives in the service layer, not in SQL.
--
-- See docs/modules/phase-3.md §7 "BVN encryption mechanism (locked)" and the
-- Slice 12 plan-first for the full design (key delivery, endpoint gating).

-- pgcrypto ships two overloads of each (the 2-arg default-cipher form and a
-- 3-arg form with an explicit cipher-algo argument) — both must be revoked,
-- or the 3-arg overload remains callable by PUBLIC and defeats the point.
REVOKE ALL ON FUNCTION pgp_sym_encrypt(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pgp_sym_encrypt(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pgp_sym_decrypt(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pgp_sym_decrypt(bytea, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION encrypt_bvn(p_bvn_plaintext TEXT)
RETURNS BYTEA
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pgp_sym_encrypt(p_bvn_plaintext, current_setting('app.bvn_key'));
$$;

CREATE OR REPLACE FUNCTION decrypt_bvn(p_bvn_encrypted BYTEA)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pgp_sym_decrypt(p_bvn_encrypted, current_setting('app.bvn_key'));
$$;

REVOKE ALL ON FUNCTION encrypt_bvn(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION decrypt_bvn(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION encrypt_bvn(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION decrypt_bvn(BYTEA) TO app_user;
