-- Immutable issuance-time class-arm attribution for historical finance reporting.
-- Nullable only for legacy invoices; every new invoice is populated by the service.
ALTER TABLE "invoices" ADD COLUMN "class_arm_id" TEXT;

CREATE INDEX "invoices_school_id_term_id_class_arm_id_idx"
  ON "invoices"("school_id", "term_id", "class_arm_id");
