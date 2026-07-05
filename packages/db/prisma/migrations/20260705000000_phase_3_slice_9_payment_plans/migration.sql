-- Phase 3 / Slice 9 — Installment plans
--
-- Adds payment_plans + payment_plan_installments.
-- A PaymentPlan is a named schedule of expected payment dates + amounts against
-- an invoice. It does NOT move money; payments still flow through the existing
-- manual / Paystack paths. Constraint: Σ installment.amount === invoice.totalDue
-- (enforced in PaymentPlanService, not in the DB).
--
-- One plan per invoice: @@unique([schoolId, invoiceId]) on payment_plans.
--
-- Installment paid status is recomputed after every successful payment via
-- PaymentPlanService.recomputeInstallmentsPaid() — threshold-based, chronological.
--
-- RLS: same tenant_isolation pattern as all other Phase 3 finance tables.

-- CreateTable
CREATE TABLE "payment_plans" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_plan_installments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payment_plan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_plans_school_id_invoice_id_key" ON "payment_plans"("school_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_plans_school_id_invoice_id_idx" ON "payment_plans"("school_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_plan_installments_school_id_plan_id_idx" ON "payment_plan_installments"("school_id", "plan_id");

-- AddForeignKey
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "payment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — payment_plans
ALTER TABLE "payment_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_plans" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payment_plans"
    USING      (school_id::text = current_setting('app.current_school_id', true))
    WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- RLS — payment_plan_installments
ALTER TABLE "payment_plan_installments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_plan_installments" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payment_plan_installments"
    USING      (school_id::text = current_setting('app.current_school_id', true))
    WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
