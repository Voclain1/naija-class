-- D37 (docs/modules/staff-mobile-companion.md): make recording a manual
-- payment idempotent.
--
-- A phone on a Nigerian mobile network loses responses. Before this, a bursar
-- who recorded N50,000, lost the reply and tapped again recorded N100,000
-- received. The client now sends one key per payment FORM; a repeat returns
-- the first payment and writes nothing.
--
-- Additive only: one nullable column and one unique index. Every existing row
-- and every existing caller (the website sends no key) carries NULL, and a
-- Postgres unique index admits any number of NULLs, so nothing already in the
-- table can violate it. The index — not the service's lookup — is what makes
-- two CONCURRENT requests with the same key produce one row.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_school_id_idempotency_key_key" ON "payments"("school_id", "idempotency_key");
