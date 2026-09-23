-- Notifications v1 (docs/modules/notifications-v1.md).
--
-- Two additive changes:
--   N2 — staff can have devices. A nullable user_id and a STAFF principal on
--        the SAME table families use: identical token, platform, last-seen and
--        send path, and one place to revoke a device rather than two.
--   N6 — one notification per person per event, enforced by a unique index
--        rather than by each caller remembering. A sibling fan-out, a retry
--        and a double-fired cron all collapse to one message.

-- The STAFF enum value is added by the migration immediately before this one
-- (20260923120000_notifications_staff_principal), because Postgres refuses to
-- use a new enum value in the transaction that added it.

-- AlterTable
ALTER TABLE "device_tokens" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- The two CHECKs that make a device row routable must learn about staff, or
-- a staff device simply cannot be stored. Same guarantees as before, widened
-- by one owner: EXACTLY ONE owner id, and principal_type agreeing with it.
ALTER TABLE "device_tokens" DROP CONSTRAINT "device_tokens_exactly_one_owner";
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_exactly_one_owner"
  CHECK (num_nonnulls("guardian_id", "student_id", "user_id") = 1);

ALTER TABLE "device_tokens" DROP CONSTRAINT "device_tokens_principal_matches_owner";
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_principal_matches_owner"
  CHECK (
    ("principal_type" = 'GUARDIAN' AND "guardian_id" IS NOT NULL) OR
    ("principal_type" = 'STUDENT'  AND "student_id"  IS NOT NULL) OR
    ("principal_type" = 'STAFF'    AND "user_id"     IS NOT NULL)
  );

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "principal_type" "principal_type" NOT NULL,
    "principal_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_school_id_event_type_event_id_princ_key"
  ON "notification_deliveries"("school_id", "event_type", "event_id", "principal_type", "principal_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_school_id_sent_at_idx" ON "notification_deliveries"("school_id", "sent_at");

-- Tenant isolation — ENABLE + FORCE with WITH CHECK, like every tenant table.
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON notification_deliveries
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, DELETE ON "notification_deliveries" TO app_user;
