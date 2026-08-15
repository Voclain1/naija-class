-- Paystack assisted setup (2026-08-15)
-- Full plan-first: docs/modules/paystack-assisted-setup.md
--
-- School.paystack_subaccount_code (20260731000000) gave a school somewhere to
-- PUT a subaccount code but no way to OBTAIN one. Paystack subaccounts belong
-- to the integration that created them, and the API holds a single
-- platform-wide PAYSTACK_SECRET_KEY (phase-4.md §8 D4), so a code a school
-- creates in its own dashboard is invisible to our GET /subaccount/:code
-- verification and can never be saved. Setup is therefore assisted: the school
-- submits banking details here, the platform operator creates the subaccount
-- on SchoolKit's integration, and returns the ACCT_ code.
--
-- SECURITY DEFINER count: 16 -> 17. One new function (section 3 below).

-- =========================================================================
-- 1. paystack_setup_requests
-- =========================================================================
-- No school_id FK, same convention as grading_schemes / guardians /
-- notification_preferences (school_id is a plain scoping column, not a
-- declared Prisma relation).
--
-- account_number is plaintext, deliberately — see D2 in the plan-first and
-- schema.prisma's model comment. StaffBankAccount.account_number (Phase 3 /
-- Slice 12) already stores staff members' PERSONAL account numbers in the
-- clear; encrypting a school's own business account here while payroll stays
-- plaintext would be inconsistent. Redaction happens in logs and audit
-- metadata (last 4 only), not at rest.

CREATE TYPE "PaystackSetupStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');

CREATE TABLE "paystack_setup_requests" (
    "id"              TEXT NOT NULL,
    "school_id"       TEXT NOT NULL,
    "business_name"   TEXT NOT NULL,
    "bank_name"       TEXT NOT NULL,
    "account_number"  TEXT NOT NULL,
    "account_name"    TEXT NOT NULL,
    "contact_name"    TEXT NOT NULL,
    "contact_email"   TEXT NOT NULL,
    "contact_phone"   TEXT NOT NULL,
    "status"          "PaystackSetupStatus" NOT NULL DEFAULT 'PENDING',
    "subaccount_code" TEXT,
    "notes"           TEXT,
    "submitted_by"    TEXT NOT NULL,
    "submitted_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilled_by"    TEXT,
    "fulfilled_at"    TIMESTAMP(3),

    CONSTRAINT "paystack_setup_requests_pkey" PRIMARY KEY ("id")
);

-- The school side reads "my latest request"; the operator reads "everything
-- still pending". Both key off this pair.
CREATE INDEX "paystack_setup_requests_school_id_status_idx"
  ON "paystack_setup_requests"("school_id", "status");

-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here.

-- =========================================================================
-- 2. RLS — flat school_id policy, same shape as notification_preferences
-- =========================================================================

ALTER TABLE "paystack_setup_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paystack_setup_requests" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON paystack_setup_requests
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 3. platform_admin_list_paystack_setup_requests()
-- =========================================================================
--
-- (a) WHY SECURITY DEFINER IS NEEDED
--     The platform-admin queue is cross-tenant by definition ("every pending
--     request, all schools"). paystack_setup_requests is under FORCE RLS and
--     the policy above keys off a single app.current_school_id GUC — one GUC
--     holds one school, so this question is unanswerable as an ordinary
--     app_user query. Identical constraint to platform_admin_list_schools()
--     and platform_admin_list_users().
--
--     Note what does NOT need a function: the banking-detail read. Once this
--     list has resolved a school_id a tenant exists, so the GUC works and RLS
--     governs that read normally — the service does it with
--     basePrisma.$transaction + `SET LOCAL app.current_school_id`, the same
--     division of concerns createSchool already uses (SECURITY DEFINER only
--     for the PRE-tenant read). That keeps this at one new function, not two,
--     and keeps every account-number read inside RLS and individually audited.
--
-- (b) RETURNS
--     request_id, school_id, school_name, business_name, status, submitted_at,
--     contact_name — enough to recognise a request and decide whether to act
--     on it.
--
-- (c) DELIBERATELY OMITS
--     account_number, bank_name, account_name, contact_email, contact_phone —
--     every field that would turn a browse surface into a banking-data dump.
--     This list renders on page load for every pending request whether or not
--     the operator is acting on one; account numbers there would spread
--     through server logs, browser memory, and anything visible on screen, on
--     every visit. Revealing them is a separate, individually-audited call
--     (paystack-setup.reveal), mirroring BvnService.revealBvn.
--
--     business_name is NOT an omission violation: it is the school's own
--     trading name, shown to parents at Paystack checkout, and is what lets
--     the operator recognise a request at a glance. contact_name likewise
--     identifies who to call — it is not contact detail, which is omitted.

CREATE FUNCTION platform_admin_list_paystack_setup_requests()
RETURNS TABLE(
  request_id    text,
  school_id     text,
  school_name   text,
  business_name text,
  status        "PaystackSetupStatus",
  submitted_at  timestamp(3),
  contact_name  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id            AS request_id,
    r.school_id     AS school_id,
    s.name          AS school_name,
    r.business_name AS business_name,
    r.status        AS status,
    r.submitted_at  AS submitted_at,
    r.contact_name  AS contact_name
  FROM paystack_setup_requests r
  JOIN schools s ON s.id = r.school_id
  ORDER BY
    -- Pending first: this is a work queue, not a log.
    (r.status <> 'PENDING'),
    r.submitted_at ASC
$$;

REVOKE ALL ON FUNCTION platform_admin_list_paystack_setup_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_list_paystack_setup_requests() TO app_user;
