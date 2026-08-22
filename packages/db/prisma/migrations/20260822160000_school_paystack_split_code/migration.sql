-- A Paystack Payment Request only honours split_code, not the transaction
-- API's subaccount/bearer fields. Nullable makes rollout deploy-safe: existing
-- enabled schools are backfilled through the verified operator workflow before
-- durable link creation is exposed.
ALTER TABLE "schools" ADD COLUMN "paystack_split_code" TEXT;
