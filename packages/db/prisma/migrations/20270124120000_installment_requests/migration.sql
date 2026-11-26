ALTER TABLE schools ADD COLUMN installment_policy JSONB;

CREATE TABLE installment_requests (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  guardian_id TEXT REFERENCES guardians(id) ON DELETE SET NULL,
  schedule JSONB NOT NULL,
  explanation TEXT CHECK (char_length(explanation) <= 500),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COUNTERED', 'APPROVED', 'REJECTED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX installment_requests_school_id_invoice_id_idx ON installment_requests(school_id, invoice_id);
CREATE UNIQUE INDEX installment_requests_one_open_per_invoice
  ON installment_requests(school_id, invoice_id) WHERE status IN ('PENDING', 'COUNTERED');
ALTER TABLE installment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON installment_requests
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
