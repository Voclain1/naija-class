-- Existing distributed links retain their original provider-managed validity.
ALTER TABLE payment_links ADD COLUMN expires_at TIMESTAMP(3);
