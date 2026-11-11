-- Store orders (2026-11-11, docs/modules/store-orders.md).
--
-- A sale becomes an ORDER: one buyer, many lines, one total, billed one of
-- three ways —
--   * FEES_INVOICE:  each line is a student charge (kind STORE) that rides on
--                    the child's fees invoice, as single sales always did;
--   * STORE_INVOICE: the same charges, billed at once onto a supplementary
--                    invoice of their own, which the family pays like any other
--                    invoice (at the counter or later, Paystack included);
--   * COUNTER:       a member of staff or a walk-in buyer pays at the counter;
--                    no invoice, the takings are recorded on the order.
-- The school sets the default for students and whether the seller may change it
-- (schools.store_billing_default, schools.store_billing_seller_choice).
--
-- A line can be handed over at once or later. Stock leaves only when it is
-- handed over: that is a SELL movement tied to the line (order_line_id), so the
-- ledger still sums to what is on the shelf. Packs are saved lists of items.
--
-- Every table is under FORCE RLS tenant_isolation; children reference
-- (school_id, id) of their parent. No SECURITY DEFINER function.

CREATE TYPE "StoreOrderBuyer" AS ENUM ('STUDENT', 'STAFF', 'WALK_IN');
CREATE TYPE "StoreOrderBilling" AS ENUM ('FEES_INVOICE', 'STORE_INVOICE', 'COUNTER');
CREATE TYPE "StoreOrderStatus" AS ENUM ('ACTIVE', 'CANCELLED');

ALTER TABLE "schools"
  ADD COLUMN "store_billing_default" "StoreOrderBilling" NOT NULL DEFAULT 'FEES_INVOICE',
  ADD COLUMN "store_billing_seller_choice" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "schools_store_billing_default" CHECK ("store_billing_default" IN ('FEES_INVOICE', 'STORE_INVOICE'));

CREATE TABLE "store_packs" (
  "id"         TEXT         NOT NULL,
  "school_id"  TEXT         NOT NULL,
  "name"       TEXT         NOT NULL,
  "note"       TEXT,
  "is_active"  BOOLEAN      NOT NULL DEFAULT true,
  "created_by" TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "store_packs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_packs_name_len" CHECK (char_length("name") BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "store_packs_school_id_id_key" ON "store_packs" ("school_id", "id");
CREATE UNIQUE INDEX "store_packs_school_name_key" ON "store_packs" ("school_id", lower("name"));

CREATE TABLE "store_pack_items" (
  "id"        TEXT    NOT NULL,
  "school_id" TEXT    NOT NULL,
  "pack_id"   TEXT    NOT NULL,
  "item_id"   TEXT    NOT NULL,
  "quantity"  INTEGER NOT NULL,
  CONSTRAINT "store_pack_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_pack_items_pack_fkey" FOREIGN KEY ("school_id", "pack_id")
    REFERENCES "store_packs" ("school_id", "id") ON DELETE CASCADE,
  CONSTRAINT "store_pack_items_item_fkey" FOREIGN KEY ("school_id", "item_id")
    REFERENCES "store_items" ("school_id", "id") ON DELETE CASCADE,
  CONSTRAINT "store_pack_items_quantity" CHECK ("quantity" BETWEEN 1 AND 1000)
);
CREATE UNIQUE INDEX "store_pack_items_key" ON "store_pack_items" ("pack_id", "item_id");

CREATE TABLE "store_orders" (
  "id"                TEXT                NOT NULL,
  "school_id"         TEXT                NOT NULL,
  "number"            INTEGER             NOT NULL,   -- per school, shown as SO-000042
  "buyer"             "StoreOrderBuyer"   NOT NULL,
  "student_id"        TEXT,
  "user_id"           TEXT,
  "buyer_name"        TEXT,                           -- a walk-in buyer's name, optional
  "billing"           "StoreOrderBilling" NOT NULL,
  "status"            "StoreOrderStatus"  NOT NULL DEFAULT 'ACTIVE',
  "total"             INTEGER             NOT NULL,   -- kobo
  "term_id"           TEXT,                           -- the term a student's charges are for
  "invoice_id"        TEXT,                           -- STORE_INVOICE: the invoice of its own
  "counter_method"    "PaymentMethod",                -- COUNTER: how it was paid
  "counter_reference" TEXT,
  "pack_id"           TEXT,
  "class_sale_id"     TEXT,                           -- orders made together for a class
  "note"              TEXT,
  "idempotency_key"   TEXT,
  "created_by"        TEXT                NOT NULL,
  "created_at"        TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_by"      TEXT,
  "cancelled_at"      TIMESTAMP(3),
  "cancel_reason"     TEXT,
  CONSTRAINT "store_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_orders_pack_fkey" FOREIGN KEY ("school_id", "pack_id")
    REFERENCES "store_packs" ("school_id", "id"),
  CONSTRAINT "store_orders_total" CHECK ("total" BETWEEN 1 AND 1000000000),
  CONSTRAINT "store_orders_buyer" CHECK (
    ("buyer" = 'STUDENT' AND "student_id" IS NOT NULL AND "user_id" IS NULL AND "buyer_name" IS NULL)
    OR ("buyer" = 'STAFF' AND "user_id" IS NOT NULL AND "student_id" IS NULL AND "buyer_name" IS NULL)
    OR ("buyer" = 'WALK_IN' AND "student_id" IS NULL AND "user_id" IS NULL)
  ),
  -- Students are billed (fees or a store invoice); everyone else pays at the counter.
  CONSTRAINT "store_orders_billing" CHECK (("buyer" = 'STUDENT') = ("billing" <> 'COUNTER')),
  CONSTRAINT "store_orders_term" CHECK (("buyer" = 'STUDENT') = ("term_id" IS NOT NULL)),
  CONSTRAINT "store_orders_invoice" CHECK (("billing" = 'STORE_INVOICE') = ("invoice_id" IS NOT NULL)),
  CONSTRAINT "store_orders_counter" CHECK (
    ("billing" = 'COUNTER') = ("counter_method" IS NOT NULL)
    AND ("counter_method" IS NULL OR "counter_method" <> 'PAYSTACK')
  ),
  CONSTRAINT "store_orders_cancelled" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR "cancel_reason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "store_orders_school_id_id_key" ON "store_orders" ("school_id", "id");
CREATE UNIQUE INDEX "store_orders_number_key" ON "store_orders" ("school_id", "number");
CREATE UNIQUE INDEX "store_orders_idempotency_key" ON "store_orders" ("school_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "store_orders_school_created_idx" ON "store_orders" ("school_id", "created_at");
CREATE INDEX "store_orders_student_idx" ON "store_orders" ("student_id");
CREATE INDEX "store_orders_class_sale_idx" ON "store_orders" ("class_sale_id");

CREATE TABLE "store_order_lines" (
  "id"         TEXT         NOT NULL,
  "school_id"  TEXT         NOT NULL,
  "order_id"   TEXT         NOT NULL,
  "item_id"    TEXT         NOT NULL,
  "variant_id" TEXT         NOT NULL,
  "quantity"   INTEGER      NOT NULL,
  "unit_price" INTEGER      NOT NULL,   -- kobo
  "amount"     INTEGER      NOT NULL,   -- quantity × unit_price, kobo
  "collected"  INTEGER      NOT NULL DEFAULT 0,
  "charge_id"  TEXT,                    -- a student's charge for this line
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_order_lines_order_fkey" FOREIGN KEY ("school_id", "order_id")
    REFERENCES "store_orders" ("school_id", "id"),
  CONSTRAINT "store_order_lines_item_fkey" FOREIGN KEY ("school_id", "item_id")
    REFERENCES "store_items" ("school_id", "id"),
  CONSTRAINT "store_order_lines_variant_fkey" FOREIGN KEY ("school_id", "variant_id")
    REFERENCES "store_item_variants" ("school_id", "id"),
  CONSTRAINT "store_order_lines_quantity" CHECK ("quantity" BETWEEN 1 AND 100000),
  CONSTRAINT "store_order_lines_price" CHECK ("unit_price" BETWEEN 1 AND 1000000000),
  CONSTRAINT "store_order_lines_amount" CHECK ("amount" = "quantity" * "unit_price"),
  CONSTRAINT "store_order_lines_collected" CHECK ("collected" BETWEEN 0 AND "quantity")
);
CREATE UNIQUE INDEX "store_order_lines_school_id_id_key" ON "store_order_lines" ("school_id", "id");
CREATE INDEX "store_order_lines_order_idx" ON "store_order_lines" ("order_id");
CREATE INDEX "store_order_lines_variant_idx" ON "store_order_lines" ("variant_id");

-- Hand-over: a SELL movement tied to its order line. A SELL now needs a price
-- and either a student (the single sale of 2026-10-19) or an order line.
ALTER TABLE "store_movements" ADD COLUMN "order_line_id" TEXT;
ALTER TABLE "store_movements"
  ADD CONSTRAINT "store_movements_order_line_fkey" FOREIGN KEY ("school_id", "order_line_id")
    REFERENCES "store_order_lines" ("school_id", "id");
ALTER TABLE "store_movements" DROP CONSTRAINT "store_movements_sale";
ALTER TABLE "store_movements" ADD CONSTRAINT "store_movements_sale" CHECK (
  "kind" <> 'SELL' OR ("unit_price" IS NOT NULL AND ("student_id" IS NOT NULL OR "order_line_id" IS NOT NULL))
);
CREATE INDEX "store_movements_order_line_idx" ON "store_movements" ("order_line_id");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_packs', 'store_pack_items', 'store_orders', 'store_order_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (school_id::text = current_setting(''app.current_school_id'', true))
         WITH CHECK (school_id::text = current_setting(''app.current_school_id'', true))', t);
  END LOOP;
END $$;
