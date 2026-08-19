-- Phase 6 / Slice 5 (D34) — Expo push device tokens.
--
-- Additive only: two new enums, one new table, no existing column dropped,
-- renamed or retyped, no backfill. Every existing row in every existing
-- table is untouched, and the feature is inert until a device registers.
-- This matters because there is no isolated staging tier (CLAUDE.md) —
-- this migration runs against the database real schools use.
--
-- No SECURITY DEFINER function. Every read and write of this table happens
-- inside an already-authenticated session (guardian or student), so a
-- school_id is always known and ordinary RLS governs it. The pre-tenant
-- chicken-and-egg that forces SECURITY DEFINER elsewhere in the auth layer
-- does not arise here. SD count stays at 20; next shape review at 23.

-- =========================================================================
-- 1. Enums
-- =========================================================================

CREATE TYPE "principal_type" AS ENUM ('GUARDIAN', 'STUDENT');
CREATE TYPE "device_platform" AS ENUM ('ANDROID', 'IOS');

-- =========================================================================
-- 2. device_tokens
-- =========================================================================

CREATE TABLE "device_tokens" (
    "id"              TEXT NOT NULL,
    "school_id"       TEXT NOT NULL,
    "principal_type"  "principal_type" NOT NULL,
    "guardian_id"     TEXT,
    "student_id"      TEXT,
    "expo_push_token" TEXT NOT NULL,
    "platform"        "device_platform" NOT NULL,
    "last_seen_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- Globally unique: one physical app install owns exactly one token, and a
-- re-registration must UPDATE that row rather than accumulate copies. It is
-- also what lets a shared handset legitimately move between principals —
-- the row is claimed by whoever most recently signed in on that install.
CREATE UNIQUE INDEX "device_tokens_expo_push_token_key" ON "device_tokens"("expo_push_token");

CREATE INDEX "device_tokens_school_id_idx"   ON "device_tokens"("school_id");
CREATE INDEX "device_tokens_guardian_id_idx" ON "device_tokens"("guardian_id");
CREATE INDEX "device_tokens_student_id_idx"  ON "device_tokens"("student_id");

-- EXACTLY ONE OWNER. Enforced in the database rather than in the service,
-- because both failure modes are silent and serious: a row with neither id
-- is unroutable (a notification that can never be delivered and never
-- errors), and a row with both would let one lookup deliver a child's
-- notification to a parent's device or the reverse. That is the same
-- cross-principal confusion the three separate session tables exist to make
-- structurally impossible — see CLAUDE.md's SECURITY DEFINER cadence review
-- on why the session resolvers are deliberately NOT merged. A CHECK keeps
-- the guarantee even if a future caller forgets it.
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_exactly_one_owner"
  CHECK (num_nonnulls("guardian_id", "student_id") = 1);

-- The principal_type column must agree with which id is set. Without this a
-- row could say GUARDIAN while carrying a student_id, and every query that
-- filters on principal_type would quietly disagree with every query that
-- joins on the id.
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_principal_matches_owner"
  CHECK (
    ("principal_type" = 'GUARDIAN' AND "guardian_id" IS NOT NULL) OR
    ("principal_type" = 'STUDENT'  AND "student_id"  IS NOT NULL)
  );

-- ON DELETE CASCADE on both: a deleted guardian or student must not leave a
-- token behind that would keep receiving notifications about them.
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_guardian_id_fkey"
  FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 3. RLS
-- =========================================================================
-- FORCE, not merely ENABLE — the runtime role (app_user) is not the table
-- owner, and FORCE is what makes the policy apply to the owner too. Every
-- other table in this schema is FORCE; a merely-ENABLEd table looks
-- identical in \d output, which is exactly why the inconsistency would be
-- hard to spot.

ALTER TABLE "device_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_tokens" FORCE  ROW LEVEL SECURITY;

-- device_tokens carries a direct school_id column, so this is the flat
-- policy — same shape as guardians / student_portal_invitations, not the
-- joined-through shape student_sessions needs.
--
-- Note what RLS does and does not do here, because the distinction has
-- already bitten this codebase once (D27): this policy is the school-to-
-- school boundary ONLY. It does not stop one guardian from touching another
-- guardian's token row within the same school. That boundary is the service
-- layer's, exactly as it is for every other guardian action on a child.
CREATE POLICY tenant_isolation ON device_tokens
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "device_tokens" TO app_user;
