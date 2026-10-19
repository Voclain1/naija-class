-- ID cards (2026-10-19, docs/modules/id-cards-and-store.md §3).
--
-- One row per card ISSUED: a card is a record, not a picture. It has a card
-- number, the academic session it is valid for, and a status. Reissuing a lost
-- card marks the old row REPLACED and adds a new one, so a found old card
-- scans as "replaced", never as valid.
--
--   * holder_kind STUDENT carries student_id, STAFF carries user_id (CHECK).
--   * card_number is the school's own running number, unique per school.
--   * At most one ACTIVE card per holder per session (partial unique index).
--
-- The public QR check resolves the school from its slug (schools has no RLS)
-- and reads the card under that school's GUC, so no SECURITY DEFINER
-- function is needed. Gated by id-card.read / id-card.issue (owner, admin).
--
-- app_user grants come from ALTER DEFAULT PRIVILEGES (no GRANT needed here).

CREATE TYPE "IdCardHolderKind" AS ENUM ('STUDENT', 'STAFF');
CREATE TYPE "IdCardStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'REPLACED');

CREATE TABLE "id_cards" (
  "id"               TEXT               NOT NULL,
  "school_id"        TEXT               NOT NULL,
  "holder_kind"      "IdCardHolderKind" NOT NULL,
  "student_id"       TEXT,                          -- plain FK -> students.id
  "user_id"          TEXT,                          -- plain FK -> users.id
  "academic_year_id" TEXT               NOT NULL,   -- plain FK -> academic_years.id
  "card_number"      TEXT               NOT NULL,
  "status"           "IdCardStatus"     NOT NULL DEFAULT 'ACTIVE',
  "issued_by"        TEXT               NOT NULL,
  "issued_at"        TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at"         TIMESTAMP(3),
  "ended_by"         TEXT,
  "end_reason"       TEXT,
  "replaced_by_id"   TEXT,                          -- the card issued in its place

  CONSTRAINT "id_cards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "id_cards_holder_check" CHECK (
    ("holder_kind" = 'STUDENT' AND "student_id" IS NOT NULL AND "user_id" IS NULL)
    OR ("holder_kind" = 'STAFF' AND "user_id" IS NOT NULL AND "student_id" IS NULL)
  ),
  CONSTRAINT "id_cards_end_check" CHECK (("status" = 'ACTIVE') = ("ended_at" IS NULL))
);

CREATE UNIQUE INDEX "id_cards_school_id_card_number_key" ON "id_cards" ("school_id", "card_number");
CREATE INDEX "id_cards_school_id_academic_year_id_idx" ON "id_cards" ("school_id", "academic_year_id");
CREATE INDEX "id_cards_student_id_idx" ON "id_cards" ("student_id");
CREATE INDEX "id_cards_user_id_idx" ON "id_cards" ("user_id");
CREATE UNIQUE INDEX "id_cards_one_active_student" ON "id_cards" ("school_id", "academic_year_id", "student_id")
  WHERE "status" = 'ACTIVE' AND "student_id" IS NOT NULL;
CREATE UNIQUE INDEX "id_cards_one_active_staff" ON "id_cards" ("school_id", "academic_year_id", "user_id")
  WHERE "status" = 'ACTIVE' AND "user_id" IS NOT NULL;

ALTER TABLE "id_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "id_cards" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "id_cards"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Owner holds "*"; admin gets both. Idempotent.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["id-card.read","id-card.issue"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
