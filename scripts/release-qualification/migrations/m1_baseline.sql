-- Fictional money tables with the column names the acceptance queries read (not the real schema).
CREATE TABLE invoices (id text PRIMARY KEY, school_id text NOT NULL, status text NOT NULL, total_amount int NOT NULL, total_discount int NOT NULL DEFAULT 0, total_due int NOT NULL, total_paid int NOT NULL DEFAULT 0);
CREATE TABLE payments (id text PRIMARY KEY, school_id text NOT NULL, invoice_id text NOT NULL, amount int NOT NULL, status text NOT NULL, paystack_reference text, allocated_kobo int, installment_id text, legacy_ref text);
CREATE TABLE payment_plans (id text PRIMARY KEY, school_id text NOT NULL, invoice_id text NOT NULL);
CREATE TABLE payment_plan_installments (id text PRIMARY KEY, school_id text NOT NULL, plan_id text NOT NULL, amount int NOT NULL);
CREATE TABLE paystack_webhook_inbox (mode text NOT NULL, event_key text NOT NULL, event_type text NOT NULL, payload jsonb, attempts int NOT NULL DEFAULT 0, received_at timestamptz NOT NULL DEFAULT now(), next_attempt_at timestamptz NOT NULL DEFAULT now(), claim_id text, claimed_until timestamptz, processed_at timestamptz, dead_at timestamptz, PRIMARY KEY (mode, event_key));
