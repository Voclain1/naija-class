-- Preserve gross Paystack receipts and historical allocations. A new online
-- payment can leave part of its gross amount unapplied pending resolution.
ALTER TABLE payments ADD COLUMN allocated_kobo INTEGER
    CHECK (allocated_kobo >= 0 AND allocated_kobo <= amount);
