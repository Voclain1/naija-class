-- Paystack subaccount routing (compressed plan-first, 2026-07-31).
-- paystack_subaccount_code: pasted by the school from their own Paystack
-- dashboard (see CLAUDE.md / this plan for why SchoolKit doesn't create it).
-- paystack_payments_enabled: defaults false (manual-only) for every school,
-- including all existing rows.
ALTER TABLE "schools" ADD COLUMN "paystack_subaccount_code" TEXT;
ALTER TABLE "schools" ADD COLUMN "paystack_payments_enabled" BOOLEAN NOT NULL DEFAULT false;
