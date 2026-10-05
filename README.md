# Vitto Loan Repayment Service

Next.js application for the Vitto MSME loan repayment assessment.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build
npm start
```

## Database

PostgreSQL, accessed with the `pg` package and plain SQL. Use a hosted database such as Neon or Supabase. Credentials are never stored in source.

1. Copy `.env.example` to `.env.local`.
2. Set `DATABASE_URL` to the Postgres connection string.
3. Initialize the schema:

```bash
npm run db:setup
```

`db/schema.sql` creates `loans`, `installments`, and `payments`. It is safe to run again: existing tables are left in place. `payments.loan_id` has a foreign key to `loans.id`. Money columns are `NUMERIC(14, 2)`.

`npm run db:seed` applies the same schema. It does not insert loans yet.

You can also export `DATABASE_URL` in the shell instead of using `.env.local`. The scripts load `.env.local` only when that file exists, and they do not override variables already set in the environment.

## Money and rounding

Amounts are integer paise inside the app and `NUMERIC(14, 2)` in Postgres. `node-pg` returns `NUMERIC` as a string, and the app does not convert those strings through JavaScript floating point.

The EMI formula is evaluated at 20 decimal places:

`EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)`, with `r = annual rate / 12 / 100`.

Each stored amount is rounded half up (away from zero at .5) to paise. Installments before the last use that rounded EMI. The final principal component is the remaining balance, so principal components sum to the original principal and the last installment carries the rounding remainder.

For ₹2,00,000 at 18% over 24 months, the rounded EMI is ₹9,984.82, which is within ₹2 of ₹9,986.

## Tests

Schedule and money unit tests:

```bash
npm test
```
