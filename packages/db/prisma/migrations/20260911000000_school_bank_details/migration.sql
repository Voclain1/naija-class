-- School bank details — direct transfer as a payment option.
-- Plan-first: docs/modules/school-bank-details.md
--
-- The school's own COLLECTION account, shown to parents who would rather
-- transfer than pay through Paystack. NOT the same thing as
-- paystack_setup_requests.account_number, even when the digits match: that is
-- the PAYOUT account the platform operator uses to create the subaccount, and
-- it is deliberately kept out of list surfaces and behind an individually
-- audited reveal. This one exists to be displayed.
--
-- bank_details_enabled defaults FALSE deliberately. Display requires the
-- toggle AND all three text fields present, so an existing school cannot
-- start showing a partial "pay to:" block the moment this migration lands —
-- every school begins with the feature off and opts in explicitly.
--
-- Additive only: four columns, all nullable or defaulted, no backfill and no
-- RLS policy change (`schools` is the tenant table every other policy keys
-- off and carries none of its own).

ALTER TABLE "schools"
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "bank_account_name" TEXT,
  ADD COLUMN "bank_account_number" TEXT,
  ADD COLUMN "bank_details_enabled" BOOLEAN NOT NULL DEFAULT false;
