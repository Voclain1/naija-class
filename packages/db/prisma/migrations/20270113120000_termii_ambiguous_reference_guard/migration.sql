-- Tenant is unknown when a signed report enters. RETURN only a single opaque
-- school ID, a null ID for an ambiguous reference, or no row for a missing
-- reference. Do not expose delivery IDs, billing, contacts or bodies.
CREATE OR REPLACE FUNCTION messaging_resolve_termii_school(p_account TEXT, p_reference TEXT)
RETURNS TABLE(school_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN count(*) = 1 THEN min(d.school_id) END
    FROM (
        SELECT n.school_id FROM public.notification_deliveries n
        WHERE n.channel = 'SMS' AND n.provider_account_id = p_account AND n.provider_ref = p_reference
        LIMIT 2
    ) d
    HAVING count(*) > 0
$$;
