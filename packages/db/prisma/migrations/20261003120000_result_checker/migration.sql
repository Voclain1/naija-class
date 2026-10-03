-- Result Checker (Phase 8c / CP6b, docs/modules/phase-8.md §21).
--
-- Hand-written, like CP6a's: `prisma migrate dev` would also sweep in the
-- pre-existing drift (array default, partial indexes) this migration must not
-- touch.
--
-- No SECURITY DEFINER function (§21.0): the public checker's only pre-tenant
-- read is `schools` by slug, which carries no RLS policy. The count stays 23.

-- =========================================================================
-- 1. Access mode, chosen at release (D18, D48)
-- =========================================================================
CREATE TYPE "result_access_mode" AS ENUM ('FREE', 'PIN');
CREATE TYPE "result_unlock_via" AS ENUM ('CHECKER', 'GUARDIAN', 'STUDENT');

-- NULL until release; every existing RELEASED card was released before PIN
-- mode existed, so it is FREE — today's behaviour, stated explicitly rather
-- than left as a NULL every reader would have to interpret.
ALTER TABLE "report_cards" ADD COLUMN "access_mode" "result_access_mode";
UPDATE "report_cards" SET "access_mode" = 'FREE' WHERE "status" = 'RELEASED';

-- =========================================================================
-- 2. PIN batches and PINs (D9, D10, D15, D16, D55, D56)
-- =========================================================================
CREATE TABLE "result_pin_batches" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,

    CONSTRAINT "result_pin_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "result_pin_batches_size_check" CHECK ("size" BETWEEN 1 AND 2000),
    CONSTRAINT "result_pin_batches_max_uses_check" CHECK ("max_uses" BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "result_pin_batches_school_id_number_key" ON "result_pin_batches"("school_id", "number");
CREATE INDEX "result_pin_batches_school_id_term_id_idx" ON "result_pin_batches"("school_id", "term_id");

CREATE TABLE "result_pins" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    -- HMAC-SHA256 under RESULT_PIN_HMAC_KEY, hex. Never the PIN (D16, D56).
    "pin_hash" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "bound_student_id" TEXT,
    "bound_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_pins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "result_pins_uses_check" CHECK ("uses" >= 0),
    CONSTRAINT "result_pins_batch_id_fkey" FOREIGN KEY ("batch_id")
      REFERENCES "result_pin_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "result_pins_school_id_pin_hash_key" ON "result_pins"("school_id", "pin_hash");
CREATE UNIQUE INDEX "result_pins_school_id_serial_key" ON "result_pins"("school_id", "serial");
CREATE INDEX "result_pins_batch_id_idx" ON "result_pins"("batch_id");

-- =========================================================================
-- 3. Unlocks — what D17's "everywhere" reads
-- =========================================================================
CREATE TABLE "result_unlocks" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "pin_id" TEXT NOT NULL,
    "via" "result_unlock_via" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_unlocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "result_unlocks_school_id_student_id_term_id_key"
  ON "result_unlocks"("school_id", "student_id", "term_id");

-- =========================================================================
-- 4. Tenant isolation — ENABLE + FORCE with WITH CHECK, like every tenant table
-- =========================================================================
ALTER TABLE "result_pin_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_pin_batches" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON result_pin_batches
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "result_pins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_pins" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON result_pins
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

ALTER TABLE "result_unlocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "result_unlocks" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON result_unlocks
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "result_pin_batches" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "result_pins" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "result_unlocks" TO app_user;

-- =========================================================================
-- 5. Permissions — idempotent append to the admin system role (owner holds
--    "*"). Kept IN SYNC with packages/db/src/seeds/system-roles.ts.
--    teacher, bursar: neither.
-- =========================================================================
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["result-pin.read","result-pin.manage"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL
  AND "key" = 'admin'
  AND "is_system" = true;
