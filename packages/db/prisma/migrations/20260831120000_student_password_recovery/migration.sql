-- A guardian-mediated student password reset needs to be distinguishable from
-- first activation: the former revokes active credentials immediately and its
-- completion carries a separate audit action.
CREATE TYPE "StudentPortalInvitationPurpose" AS ENUM ('ACTIVATION', 'PASSWORD_RESET');

ALTER TABLE "student_portal_invitations"
  ADD COLUMN "purpose" "StudentPortalInvitationPurpose" NOT NULL DEFAULT 'ACTIVATION';

-- The pre-authentication resolver returns no PII, only the invitation's
-- purpose so the acceptance transaction can write the correct audit action.
DROP FUNCTION IF EXISTS auth_resolve_student_invitation(text);
CREATE FUNCTION auth_resolve_student_invitation(p_token_hash text)
RETURNS TABLE(
  invitation_id text,
  school_id     text,
  student_id    text,
  expires_at    timestamp(3),
  purpose       "StudentPortalInvitationPurpose"
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT spi.id, spi.school_id, spi.student_id, spi.expires_at, spi.purpose
  FROM student_portal_invitations spi
  WHERE spi.token_hash = p_token_hash
    AND spi.accepted_at IS NULL
    AND spi.revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION auth_resolve_student_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_resolve_student_invitation(text) TO app_user;
