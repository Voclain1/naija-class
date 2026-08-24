-- Staff mobile auth foundation. Existing sessions remain WEB. Mobile
-- sessions carry an install-scoped random id (never a hardware identifier)
-- and use a separately capped lifetime in application code.
ALTER TABLE "schools"
  ADD COLUMN "staff_mobile_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "SessionClientType" AS ENUM ('WEB', 'MOBILE');

ALTER TABLE "sessions"
  ADD COLUMN "client_type" "SessionClientType" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "device_id" TEXT,
  ADD COLUMN "device_name" TEXT,
  ADD COLUMN "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "sessions_user_id_client_type_idx"
  ON "sessions"("user_id", "client_type");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_mobile_device_shape_check" CHECK (
    ("client_type" = 'WEB' AND "device_id" IS NULL AND "device_name" IS NULL)
    OR
    ("client_type" = 'MOBILE' AND "device_id" IS NOT NULL AND length("device_id") BETWEEN 16 AND 128
      AND "device_name" IS NOT NULL AND length("device_name") BETWEEN 1 AND 80)
  );
