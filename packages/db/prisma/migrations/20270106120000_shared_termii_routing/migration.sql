-- The authenticated callback has no tenant yet. Resolve an exact SMS provider
-- reference to one school under FORCE RLS. Return only the opaque school ID.
-- Ambiguous references return no row. This never returns contacts or content.
CREATE INDEX notification_deliveries_termii_lookup_idx
    ON notification_deliveries (provider_account_id, provider_ref)
    INCLUDE (school_id)
    WHERE channel = 'SMS' AND provider_account_id IS NOT NULL AND provider_ref IS NOT NULL;

CREATE FUNCTION messaging_resolve_termii_school(p_account TEXT, p_reference TEXT)
RETURNS TABLE(school_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT min(d.school_id)
    FROM (
        SELECT n.school_id FROM public.notification_deliveries n
        WHERE n.channel = 'SMS' AND n.provider_account_id = p_account AND n.provider_ref = p_reference
        LIMIT 2
    ) d
    HAVING count(*) = 1
$$;

REVOKE ALL ON FUNCTION messaging_resolve_termii_school(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION messaging_resolve_termii_school(TEXT, TEXT) TO app_user;

-- Account-scoped pre-routing inbox. No recipient, tenant-supplied ID, body,
-- signature or credential is retained. The signed account controls the scope.
CREATE TABLE messaging_termii_inbox (
    account_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    provider_ref TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('SENT', 'FAILED', 'DELIVERED')),
    received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, report_id, provider_ref, state)
);
CREATE INDEX messaging_termii_inbox_account_attempt_idx
    ON messaging_termii_inbox (account_id, next_attempt_at, received_at);
