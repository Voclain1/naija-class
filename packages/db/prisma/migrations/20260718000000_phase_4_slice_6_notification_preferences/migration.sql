-- Phase 4 / Slice 6 — Notification channels (D3): per-school email/SMS
-- toggles. See docs/modules/phase-4.md §3 ("Notifications (slice 6) — first
-- cut") and §8 ("Slice 6 plan-first decisions") for the full scope
-- rationale — this migration covers D3 only (invoice-issued/payment-
-- received triggers and the Announcement model are deferred to a later
-- slice, per §8 D2).
--
-- No SECURITY DEFINER function needed — notification_preferences is an
-- ordinary tenant-scoped table, read/written only by authenticated
-- admin/owner requests already inside withTenant(). SD count stays at 10.

-- =========================================================================
-- 1. notification_preferences
-- =========================================================================
-- One row per school, created on first configure (no seed row on school
-- creation — a missing row means "use the schema defaults", read at the
-- service layer rather than backfilled here). No school_id FK, same
-- convention as grading_schemes/guardians (schoolId is a plain scoping
-- column, not a declared Prisma relation).

CREATE TABLE "notification_preferences" (
    "id"            TEXT NOT NULL,
    "school_id"     TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled"   BOOLEAN NOT NULL DEFAULT false,
    "push_enabled"  BOOLEAN NOT NULL DEFAULT false,
    "updated_by"    TEXT NOT NULL,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_school_id_key" ON "notification_preferences"("school_id");

-- app_user grants: ALTER DEFAULT PRIVILEGES (slice 1 Neon setup) auto-grants
-- SELECT/INSERT/UPDATE/DELETE on every future table created by school_kit to
-- app_user — no manual GRANT needed here.

-- =========================================================================
-- 2. RLS — flat school_id policy, same shape as grading_schemes
--    (packages/db/prisma/policies/phase-2.sql)
-- =========================================================================

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON notification_preferences
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- =========================================================================
-- 3. RBAC: add notification-preferences.read/update to the system admin role
-- =========================================================================
-- Same idempotent pattern as every prior RBAC-rollup migration. Not a
-- highest-trust surface (no owner-only restriction) — same reasoning as
-- grading-scheme.*. Owner already has '*'. Bursar is not granted this —
-- finance-only role, untouched by this migration, same as guardian.invite.
-- packages/db/src/seeds/system-roles.ts's ADMIN_PERMISSIONS is updated in
-- the same PR so a FRESH `pnpm db:seed` matches this UPDATE exactly.

UPDATE "roles"
SET "permissions" = "permissions" || '["notification-preferences.read","notification-preferences.update"]'::jsonb
WHERE "key" = 'admin'
  AND "is_system" = true
  AND NOT ("permissions" @> '["notification-preferences.read"]'::jsonb);
