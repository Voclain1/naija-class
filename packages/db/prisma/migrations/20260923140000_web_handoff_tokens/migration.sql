-- Opening the website from the app, already signed in
-- (docs/modules/web-handoff-signin.md).
--
-- A single-use, 60-second token the app mints and the browser exchanges once
-- for a real session. The app's own session token never travels in a URL,
-- because a URL lands in browser history, referrer headers and server logs.
--
-- Deliberately NOT a reuse of password_reset_tokens: separate tables make
-- cross-purpose token confusion structurally impossible, the same rule the
-- SECURITY DEFINER review applied to the session resolvers.

-- CreateTable
CREATE TABLE "web_handoff_tokens" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_handoff_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_handoff_tokens_token_hash_key" ON "web_handoff_tokens"("token_hash");
CREATE INDEX "web_handoff_tokens_school_id_idx" ON "web_handoff_tokens"("school_id");
CREATE INDEX "web_handoff_tokens_user_id_idx" ON "web_handoff_tokens"("user_id");

-- Tenant isolation — ENABLE + FORCE with WITH CHECK, like every tenant table.
ALTER TABLE "web_handoff_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_handoff_tokens" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON web_handoff_tokens
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "web_handoff_tokens" TO app_user;

-- =========================================================================
-- auth_resolve_web_handoff_token(token_hash)
-- =========================================================================
--
-- The browser arrives with a token and no session, so there is no school_id
-- to scope to until after the lookup — the same chicken-and-egg problem as
-- auth_resolve_password_reset_token, and solved the same way.
--
-- SECURITY DEFINER discipline (CLAUDE.md):
--   (a) WHY: web_handoff_tokens is under FORCE RLS and this read is
--       pre-tenant by definition.
--   (b) RETURNS: handoff_id, user_id, school_id, session_id, expires_at,
--       used_at — ids and timestamps only, so the caller can tell "expired"
--       from "already used" and then do every subsequent read under the GUC.
--   (c) DELIBERATELY OMITS: token_hash (the caller holds it), and anything
--       about the person — no name, no email, no role. This endpoint is
--       PUBLIC and takes an attacker-supplied token; a name would turn a
--       guessed token into a disclosure of whose account it opens, the same
--       reasoning as auth_resolve_student_invitation.
--
-- Liveness is deliberately NOT in the WHERE clause: used_at and expires_at
-- are returned so the caller can distinguish the cases, and single-use is
-- enforced atomically at the UPDATE, never by trusting this read.
CREATE OR REPLACE FUNCTION auth_resolve_web_handoff_token(p_token_hash text)
RETURNS TABLE(
  handoff_id text,
  user_id    text,
  school_id  text,
  session_id text,
  expires_at timestamp(3),
  used_at    timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    wht.id         AS handoff_id,
    wht.user_id    AS user_id,
    wht.school_id  AS school_id,
    wht.session_id AS session_id,
    wht.expires_at AS expires_at,
    wht.used_at    AS used_at
  FROM web_handoff_tokens wht
  WHERE wht.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION auth_resolve_web_handoff_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_web_handoff_token(text) TO app_user;
