-- Pre-check helper for /auth/signup-owner.
--
-- Why this function exists:
--   `users` has FORCE ROW LEVEL SECURITY enabled. When a UNIQUE INDEX
--   on a column under FORCE RLS rejects an INSERT, Postgres deliberately
--   strips the constraint name from the error to avoid leaking which
--   tenant owns the conflicting row. Prisma surfaces this as
--   `target: null` + `message: "Unique constraint failed on the (not
--   available)"`, which means the application cannot tell whether the
--   collision was on email or phone — both are common UX-distinct cases.
--
--   To get a deterministic answer, we run a pre-check via this function.
--   It is SECURITY DEFINER and owned by the migration role (school_kit,
--   which has BYPASSRLS implied via SUPERUSER for the dev environment;
--   prod will own this function with a dedicated owner role). The
--   function NEVER returns row data — only two booleans — so it leaks
--   no more than the API's response already does ("email taken" /
--   "phone taken"), which is unavoidable for a signup UX.
--
-- Race conditions:
--   Pre-check followed by INSERT is not atomic. If two signups race on
--   the same email between the check and the INSERT, the second one
--   trips the underlying UNIQUE index and the service maps it to the
--   generic UNIQUE_VIOLATION code. That is acceptable: the rare race
--   becomes a less-helpful error, not a corrupted row.

CREATE OR REPLACE FUNCTION auth_check_signup_uniqueness(
  p_email text,
  p_phone text
)
RETURNS TABLE(email_taken boolean, phone_taken boolean)
LANGUAGE sql
SECURITY DEFINER
-- Pin search_path to prevent search-path hijacking on SECURITY DEFINER
-- functions (a known privilege-escalation vector if a low-privilege role
-- can create objects in a schema earlier on the path).
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS(SELECT 1 FROM users WHERE email = p_email) AS email_taken,
    EXISTS(SELECT 1 FROM users WHERE phone = p_phone) AS phone_taken
$$;

-- Lock down execution: PUBLIC cannot call it, app_user can.
REVOKE ALL ON FUNCTION auth_check_signup_uniqueness(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_check_signup_uniqueness(text, text) TO app_user;
