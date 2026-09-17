-- Guardian portal invitations: a revoke path, and with it a real resend.
--
-- WHY: until now a guardian invitation could only be issued once and then
-- waited out. `GuardiansService.invite` refuses while an invitation is
-- outstanding (INVITATION_ALREADY_PENDING), the accept link is shown once in
-- the admin's browser and never stored, and the TTL is 7 days — so "the
-- parent never got the email" or "we typed the wrong address" left the school
-- stuck for a week with no way to re-send and no way to cancel. Measured in
-- production 2026-09-16: 5 of 17 real invitations expired unaccepted.
--
-- The column mirrors StudentPortalInvitation.revoked_at (Phase 6 / Slice 3,
-- D26), which exists for the same reason: a link someone already holds must
-- be killable, not merely superseded. GuardianInvitation's own header comment
-- said it "has no revoke path" — that is what this migration changes, and the
-- comment is updated in the same commit.

ALTER TABLE "guardian_invitations" ADD COLUMN "revoked_at" TIMESTAMP(3);

-- Liveness moves INTO the resolver's WHERE clause, exactly as
-- auth_resolve_student_invitation does, and for the same reason: a revoked
-- token must stop resolving as a property of the function, not as a check
-- every future caller has to remember. A revoked invitation now returns NO
-- ROWS, which the accept endpoints already map to "invalid or expired".
--
-- accepted_at and expires_at stay in the RETURN shape (unlike the student
-- resolver's treatment of accepted_at) because the guardian accept page
-- distinguishes "already used" from "expired" in its message, and neither
-- state is reachable for a revoked row anyway.
--
-- Return shape is UNCHANGED, so CREATE OR REPLACE is sufficient here and the
-- existing REVOKE/GRANT survive (a DROP would reset them — see CLAUDE.md).
-- search_path stays pinned in the body below; the conformance spec
-- (security-definer-inventory.spec.ts) re-checks all four properties in CI.

CREATE OR REPLACE FUNCTION auth_resolve_guardian_invitation_by_token_hash(p_token_hash text)
RETURNS TABLE(
  invitation_id text,
  school_id     text,
  guardian_id   text,
  first_name    text,
  last_name     text,
  email         text,
  invited_by    text,
  expires_at    timestamp(3),
  accepted_at   timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    gi.id          AS invitation_id,
    gi.school_id   AS school_id,
    gi.guardian_id AS guardian_id,
    g.first_name   AS first_name,
    g.last_name    AS last_name,
    g.email        AS email,
    gi.invited_by  AS invited_by,
    gi.expires_at  AS expires_at,
    gi.accepted_at AS accepted_at
  FROM guardian_invitations gi
  JOIN guardians g ON g.id = gi.guardian_id
  WHERE gi.token_hash = p_token_hash
    AND gi.revoked_at IS NULL
$$;
