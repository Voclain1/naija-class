-- Phase 9 / CP8.2 — images, safety and retention for messaging
-- (docs/modules/phase-9.md §17.8, approved 2026-10-18).
--
--   * IMAGES: up to 3 a message, JPG/PNG/WebP, 5 MB each, typed by their
--     bytes. Uploaded one at a time and STAGED (message_id NULL) by the person
--     writing, then attached when the message is sent; a staged image never
--     attached is deleted after a day. Stored privately, read through
--     5-minute links by those who can see the conversation, deleted with it.
--     A message may now be images only, so the body may be empty (the service
--     requires text or an image).
--   * FLAGS: a parent's report, a member of staff's flag, or a safeguarding
--     word opens the conversation to the owner and admins (owner's answer,
--     §17.8) and keeps it past the two-year deletion until an admin clears it.
--     Clearing needs the new `messages.oversee` (admin; owner by "*").
--
-- No new SECURITY DEFINER function; the count stays 23.

ALTER TABLE "messages" DROP CONSTRAINT "messages_body";
ALTER TABLE "messages" ADD CONSTRAINT "messages_body" CHECK (char_length("body") <= 2000);
ALTER TABLE "messages" ADD COLUMN "safeguarding_match" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "message_threads"
  ADD COLUMN "flagged_at" TIMESTAMP(3),
  ADD COLUMN "flag_reason" TEXT,
  ADD COLUMN "flag_note" TEXT,
  ADD COLUMN "flagged_by_kind" TEXT,
  ADD COLUMN "flagged_by_id" TEXT;
ALTER TABLE "message_threads"
  ADD CONSTRAINT "message_threads_flag" CHECK (
    ("flagged_at" IS NULL AND "flag_reason" IS NULL AND "flag_note" IS NULL AND "flagged_by_kind" IS NULL AND "flagged_by_id" IS NULL)
    OR ("flagged_at" IS NOT NULL AND "flag_reason" IN ('REPORTED', 'STAFF_FLAG', 'SAFEGUARDING_WORDS')
        AND "flagged_by_kind" IN ('GUARDIAN', 'STAFF', 'SYSTEM'))),
  ADD CONSTRAINT "message_threads_flag_note" CHECK ("flag_note" IS NULL OR char_length("flag_note") <= 500);
CREATE INDEX "message_threads_school_id_flagged_at_idx" ON "message_threads"("school_id", "flagged_at");

CREATE TABLE "message_images" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    -- NULL while staged; set when the message is sent.
    "message_id" TEXT,
    "uploader_kind" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_images_uploader" CHECK ("uploader_kind" IN ('GUARDIAN', 'STAFF')),
    CONSTRAINT "message_images_ext" CHECK ("ext" IN ('jpg', 'png', 'webp')),
    CONSTRAINT "message_images_size" CHECK ("size_bytes" BETWEEN 1 AND 5242880)
);
CREATE INDEX "message_images_message_id_idx" ON "message_images"("message_id");
CREATE INDEX "message_images_school_id_uploader_idx" ON "message_images"("school_id", "uploader_kind", "uploader_id");
ALTER TABLE "message_images" ADD CONSTRAINT "message_images_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_images" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_images
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_images" TO app_user;

-- Admin gains messages.oversee. Owner holds "*". Idempotent; kept in sync
-- with packages/db/src/seeds/system-roles.ts.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["messages.oversee"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
