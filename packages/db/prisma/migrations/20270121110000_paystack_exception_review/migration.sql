ALTER TABLE "paystack_payment_exceptions"
  ADD COLUMN "review_status" TEXT NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD CONSTRAINT "paystack_payment_exceptions_review_status_check"
    CHECK ("review_status" IN ('OPEN', 'ACKNOWLEDGED', 'PROVIDER_ESCALATED', 'EVIDENCE_RECORDED'));
