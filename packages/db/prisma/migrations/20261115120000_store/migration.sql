-- The Store and the fixed-assets register (2026-10-19,
-- docs/modules/id-cards-and-store.md §4, approved by the owner with answers
-- 4 and 5: a fixed-assets register now, and a Storekeeper role; the bursar
-- has some control, the owner and admin full control).
--
--   * store_items / store_item_variants — what the store holds. Every item has
--     at least one variant (a size, or a single unnamed one), and stock is kept
--     per variant. Prices and costs are kobo (INTEGER, CLAUDE.md's money rule).
--   * store_movements — the ledger. Stock is never edited: every change is a
--     movement (receive, issue, sell, return, write-off, stock-take adjustment)
--     with a signed quantity, and stock on hand is their sum. Rows are never
--     updated or deleted (trigger below), except when the platform deletes the
--     whole school.
--   * store_stock_takes / store_stock_take_lines — a count sheet; submitted
--     counts become ADJUST movements when someone with store.approve approves.
--   * fixed_assets / fixed_asset_events — the register, with every move,
--     assignment, condition and status change kept as history.
--
-- Selling to a student bills them through student charges (kind STORE), the
-- one path that writes student_charges. No SECURITY DEFINER function.
-- app_user grants come from ALTER DEFAULT PRIVILEGES (no GRANT needed here).

ALTER TYPE "StudentChargeKind" ADD VALUE IF NOT EXISTS 'STORE';

CREATE TYPE "StoreCategory" AS ENUM
  ('UNIFORM', 'TEXTBOOK', 'STATIONERY', 'LABORATORY', 'SPORTS', 'ICT', 'CLEANING', 'KITCHEN', 'OTHER');
CREATE TYPE "StoreMovementKind" AS ENUM ('RECEIVE', 'ISSUE', 'SELL', 'RETURN', 'WRITE_OFF', 'ADJUST');
CREATE TYPE "StoreStockTakeStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'CANCELLED');
CREATE TYPE "FixedAssetCategory" AS ENUM
  ('ICT', 'FURNITURE', 'LABORATORY', 'SPORTS', 'AUDIO_VISUAL', 'VEHICLE', 'KITCHEN', 'BUILDING', 'OTHER');
CREATE TYPE "FixedAssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR', 'BROKEN');
CREATE TYPE "FixedAssetStatus" AS ENUM ('IN_USE', 'IN_STORE', 'UNDER_REPAIR', 'DISPOSED');
CREATE TYPE "FixedAssetEventKind" AS ENUM ('ADDED', 'MOVED', 'ASSIGNED', 'CONDITION', 'STATUS', 'EDITED');

CREATE TABLE "store_items" (
  "id"            TEXT            NOT NULL,
  "school_id"     TEXT            NOT NULL,
  "name"          TEXT            NOT NULL,
  "code"          TEXT,
  "category"      "StoreCategory" NOT NULL,
  "unit"          TEXT            NOT NULL DEFAULT 'piece',
  "reorder_level" INTEGER         NOT NULL DEFAULT 0,
  "sell_price"    INTEGER,                         -- kobo; null = not for sale
  "notes"         TEXT,
  "is_active"     BOOLEAN         NOT NULL DEFAULT true,
  "created_by"    TEXT            NOT NULL,
  "created_at"    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "store_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_items_name_len" CHECK (char_length("name") BETWEEN 1 AND 120),
  CONSTRAINT "store_items_reorder_level" CHECK ("reorder_level" >= 0),
  CONSTRAINT "store_items_sell_price" CHECK ("sell_price" IS NULL OR "sell_price" BETWEEN 1 AND 1000000000)
);
CREATE UNIQUE INDEX "store_items_school_id_code_key" ON "store_items" ("school_id", lower("code")) WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX "store_items_school_id_id_key" ON "store_items" ("school_id", "id");

CREATE TABLE "store_item_variants" (
  "id"          TEXT         NOT NULL,
  "school_id"   TEXT         NOT NULL,
  "item_id"     TEXT         NOT NULL,
  "label"       TEXT,                              -- e.g. "Size 10"; null for an item without sizes
  "sell_price"  INTEGER,                           -- kobo; overrides the item's price
  "is_active"   BOOLEAN      NOT NULL DEFAULT true,
  "sort_order"  INTEGER      NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_item_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_item_variants_item_fkey" FOREIGN KEY ("school_id", "item_id")
    REFERENCES "store_items" ("school_id", "id") ON DELETE CASCADE,
  CONSTRAINT "store_item_variants_sell_price" CHECK ("sell_price" IS NULL OR "sell_price" BETWEEN 1 AND 1000000000)
);
CREATE UNIQUE INDEX "store_item_variants_label_key" ON "store_item_variants" ("item_id", coalesce(lower("label"), ''));
CREATE UNIQUE INDEX "store_item_variants_school_id_id_key" ON "store_item_variants" ("school_id", "id");

CREATE TABLE "store_stock_takes" (
  "id"           TEXT                   NOT NULL,
  "school_id"    TEXT                   NOT NULL,
  "status"       "StoreStockTakeStatus" NOT NULL DEFAULT 'OPEN',
  "note"         TEXT,
  "created_by"   TEXT                   NOT NULL,
  "created_at"   TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_by" TEXT,
  "submitted_at" TIMESTAMP(3),
  "decided_by"   TEXT,
  "decided_at"   TIMESTAMP(3),
  CONSTRAINT "store_stock_takes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_stock_takes_school_id_id_key" ON "store_stock_takes" ("school_id", "id");
-- One count at a time: two open sheets would each adjust the same stock.
CREATE UNIQUE INDEX "store_stock_takes_one_live" ON "store_stock_takes" ("school_id")
  WHERE "status" IN ('OPEN', 'SUBMITTED');

CREATE TABLE "store_stock_take_lines" (
  "id"            TEXT    NOT NULL,
  "school_id"     TEXT    NOT NULL,
  "stock_take_id" TEXT    NOT NULL,
  "variant_id"    TEXT    NOT NULL,
  "expected"      INTEGER,          -- stock on hand when submitted
  "counted"       INTEGER,          -- null until counted
  CONSTRAINT "store_stock_take_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_stock_take_lines_take_fkey" FOREIGN KEY ("school_id", "stock_take_id")
    REFERENCES "store_stock_takes" ("school_id", "id") ON DELETE CASCADE,
  CONSTRAINT "store_stock_take_lines_variant_fkey" FOREIGN KEY ("school_id", "variant_id")
    REFERENCES "store_item_variants" ("school_id", "id") ON DELETE CASCADE,
  CONSTRAINT "store_stock_take_lines_counted" CHECK ("counted" IS NULL OR "counted" >= 0)
);
CREATE UNIQUE INDEX "store_stock_take_lines_key" ON "store_stock_take_lines" ("stock_take_id", "variant_id");

CREATE TABLE "store_movements" (
  "id"                TEXT                NOT NULL,
  "school_id"         TEXT                NOT NULL,
  "variant_id"        TEXT                NOT NULL,
  "item_id"           TEXT                NOT NULL,
  "kind"              "StoreMovementKind" NOT NULL,
  "quantity"          INTEGER             NOT NULL,  -- signed: + into the store, - out
  "unit_cost"         INTEGER,                       -- kobo, receives
  "unit_price"        INTEGER,                       -- kobo, sales
  "student_id"        TEXT,                          -- issued or sold to, or returned by
  "user_id"           TEXT,                          -- issued to a member of staff
  "department"        TEXT,                          -- issued to a department or class
  "supplier"          TEXT,
  "reference"         TEXT,                          -- delivery note, receipt no.
  "reason"            TEXT,
  "student_charge_id" TEXT,                          -- the bill raised by a sale
  "stock_take_id"     TEXT,
  "created_by"        TEXT                NOT NULL,
  "created_at"        TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_movements_variant_fkey" FOREIGN KEY ("school_id", "variant_id")
    REFERENCES "store_item_variants" ("school_id", "id"),
  CONSTRAINT "store_movements_item_fkey" FOREIGN KEY ("school_id", "item_id")
    REFERENCES "store_items" ("school_id", "id"),
  CONSTRAINT "store_movements_quantity" CHECK ("quantity" <> 0 AND abs("quantity") <= 1000000),
  CONSTRAINT "store_movements_direction" CHECK (
    ("kind" IN ('RECEIVE', 'RETURN') AND "quantity" > 0)
    OR ("kind" IN ('ISSUE', 'SELL', 'WRITE_OFF') AND "quantity" < 0)
    OR "kind" = 'ADJUST'
  ),
  CONSTRAINT "store_movements_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" BETWEEN 0 AND 1000000000),
  CONSTRAINT "store_movements_unit_price" CHECK ("unit_price" IS NULL OR "unit_price" BETWEEN 1 AND 1000000000),
  CONSTRAINT "store_movements_sale" CHECK ("kind" <> 'SELL' OR ("student_id" IS NOT NULL AND "unit_price" IS NOT NULL)),
  CONSTRAINT "store_movements_write_off_reason" CHECK ("kind" NOT IN ('WRITE_OFF', 'ADJUST') OR "reason" IS NOT NULL)
);
CREATE INDEX "store_movements_variant_idx" ON "store_movements" ("variant_id");
CREATE INDEX "store_movements_school_created_idx" ON "store_movements" ("school_id", "created_at");
CREATE INDEX "store_movements_student_idx" ON "store_movements" ("student_id");

-- The ledger is append-only. A whole-school deletion by the platform is the
-- one exception (the same escape exam_paper_frozen_guard() allows).
CREATE OR REPLACE FUNCTION store_movements_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM schools WHERE id = OLD.school_id AND deletion_started_at IS NOT NULL
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'store_movements is append-only; record a new movement instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "store_movements_append_only"
  BEFORE UPDATE OR DELETE ON "store_movements"
  FOR EACH ROW EXECUTE FUNCTION store_movements_append_only();

CREATE TABLE "fixed_assets" (
  "id"                  TEXT                  NOT NULL,
  "school_id"           TEXT                  NOT NULL,
  "tag"                 TEXT                  NOT NULL,   -- the number painted or stuck on it
  "name"                TEXT                  NOT NULL,
  "category"            "FixedAssetCategory"  NOT NULL,
  "location"            TEXT,
  "assigned_to_user_id" TEXT,
  "assigned_to_text"    TEXT,                             -- a department or class, when not a person
  "condition"           "FixedAssetCondition" NOT NULL DEFAULT 'GOOD',
  "status"              "FixedAssetStatus"    NOT NULL DEFAULT 'IN_USE',
  "serial_number"       TEXT,
  "supplier"            TEXT,
  "purchase_date"       DATE,
  "purchase_cost"       INTEGER,                          -- kobo
  "notes"               TEXT,
  "disposed_at"         DATE,
  "disposal_reason"     TEXT,
  "created_by"          TEXT                  NOT NULL,
  "created_at"          TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)          NOT NULL,
  CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixed_assets_cost" CHECK ("purchase_cost" IS NULL OR "purchase_cost" BETWEEN 0 AND 100000000000),
  CONSTRAINT "fixed_assets_disposed" CHECK (("status" = 'DISPOSED') = ("disposed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "fixed_assets_school_id_tag_key" ON "fixed_assets" ("school_id", lower("tag"));
CREATE UNIQUE INDEX "fixed_assets_school_id_id_key" ON "fixed_assets" ("school_id", "id");

CREATE TABLE "fixed_asset_events" (
  "id"         TEXT                  NOT NULL,
  "school_id"  TEXT                  NOT NULL,
  "asset_id"   TEXT                  NOT NULL,
  "kind"       "FixedAssetEventKind" NOT NULL,
  "from_value" TEXT,
  "to_value"   TEXT,
  "note"       TEXT,
  "created_by" TEXT                  NOT NULL,
  "created_at" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fixed_asset_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixed_asset_events_asset_fkey" FOREIGN KEY ("school_id", "asset_id")
    REFERENCES "fixed_assets" ("school_id", "id") ON DELETE CASCADE
);
CREATE INDEX "fixed_asset_events_asset_idx" ON "fixed_asset_events" ("asset_id", "created_at");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_items', 'store_item_variants', 'store_stock_takes', 'store_stock_take_lines',
                           'store_movements', 'fixed_assets', 'fixed_asset_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (school_id::text = current_setting(''app.current_school_id'', true))
         WITH CHECK (school_id::text = current_setting(''app.current_school_id'', true))', t);
  END LOOP;
END $$;

-- The Storekeeper (owner's answer 5): runs the store and the asset register
-- day to day, and exports its lists (export.table). Sees and changes nothing else.
INSERT INTO "roles" ("id", "school_id", "key", "name", "description", "is_system", "permissions", "created_at")
SELECT gen_random_uuid()::text, NULL, 'storekeeper', 'Storekeeper',
    'Runs the school store and the asset register: items, receiving, issuing, stock takes and assets. No academic, finance, health, staff or settings access.',
    true, '["store.read","store.manage","asset.read","asset.manage","export.table"]'::jsonb, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "school_id" IS NULL AND "key" = 'storekeeper' AND "is_system" = true);

-- Admin: everything. Bursar: sees stock, its value and the register, sells to
-- students (billing) and approves stock-take adjustments, but does not edit
-- items or assets. Owner holds "*". Idempotent.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["store.read","store.manage","store.sell","store.approve","asset.read","asset.manage"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;

UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["store.read","store.sell","store.approve","asset.read"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'bursar' AND "is_system" = true;
