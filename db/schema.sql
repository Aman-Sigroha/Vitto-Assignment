-- Idempotent setup for a new or already-initialized database.
-- Re-running creates missing tables and indexes. It does not alter an older shape.

CREATE TABLE IF NOT EXISTS loans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  principal NUMERIC(14, 2) NOT NULL CHECK (principal > 0),
  annual_interest_rate NUMERIC(8, 4) NOT NULL CHECK (annual_interest_rate >= 0),
  tenure_months INTEGER NOT NULL CHECK (tenure_months > 0),
  disbursement_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS installments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL REFERENCES loans (id),
  installment_no INTEGER NOT NULL CHECK (installment_no > 0),
  due_date DATE NOT NULL,
  principal_due NUMERIC(14, 2) NOT NULL CHECK (principal_due >= 0),
  interest_due NUMERIC(14, 2) NOT NULL CHECK (interest_due >= 0),
  total_due NUMERIC(14, 2) NOT NULL CHECK (total_due = principal_due + interest_due),
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0 AND amount_paid <= total_due),
  UNIQUE (loan_id, installment_no)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loan_id BIGINT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans (id),
  UNIQUE (loan_id, idempotency_key)
);

-- Unique (loan_id, installment_no) and (loan_id, idempotency_key) already index loan_id.
CREATE INDEX IF NOT EXISTS installments_loan_id_due_date_idx
  ON installments (loan_id, due_date);

CREATE INDEX IF NOT EXISTS payments_loan_id_payment_date_idx
  ON payments (loan_id, payment_date);
