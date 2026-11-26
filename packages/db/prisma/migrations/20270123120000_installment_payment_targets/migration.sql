-- An immutable checkout target, retained even while viewing reversed payments.
ALTER TABLE payments ADD COLUMN installment_id TEXT
    REFERENCES payment_plan_installments(id) ON DELETE RESTRICT;
ALTER TABLE payment_links ADD COLUMN installment_id TEXT
    REFERENCES payment_plan_installments(id) ON DELETE RESTRICT;
DROP INDEX payment_links_one_active_per_invoice_key;
CREATE UNIQUE INDEX payment_links_one_active_per_invoice_key
    ON payment_links(school_id, invoice_id)
    WHERE installment_id IS NULL AND status IN ('CREATING', 'LIVE');
CREATE UNIQUE INDEX payment_links_one_active_per_installment_key
    ON payment_links(school_id, invoice_id, installment_id)
    WHERE installment_id IS NOT NULL AND status IN ('CREATING', 'LIVE');
