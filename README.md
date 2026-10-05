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

`db/schema.sql` creates `loans`, `installments`, `payments`, and `payment_allocations`. It is safe to run again: existing tables are left in place. `payments.loan_id` has a foreign key to `loans.id`. Money columns are `NUMERIC(14, 2)`.

`npm run db:seed` applies the same schema. It does not insert loans yet.

You can also export `DATABASE_URL` in the shell instead of using `.env.local`. The scripts load `.env.local` only when that file exists, and they do not override variables already set in the environment.

## Money and rounding

Amounts are integer paise inside the app and `NUMERIC(14, 2)` in Postgres. `node-pg` returns `NUMERIC` as a string, and the app does not convert those strings through JavaScript floating point.

The EMI formula is evaluated at 20 decimal places:

`EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)`, with `r = annual rate / 12 / 100`.

Each stored amount is rounded half up (away from zero at .5) to paise. Installments before the last use that rounded EMI. The final principal component is the remaining balance, so principal components sum to the original principal and the last installment carries the rounding remainder.

For ₹2,00,000 at 18% over 24 months, the rounded EMI is ₹9,984.82, which is within ₹2 of ₹9,986.

## API

Routes call `requireRequestUser` before any loan or payment work. Firebase token checks are not implemented yet, so that function does not accept a user and does not enforce a token. Stage 5 will reject missing tokens with HTTP 401.

Money fields are decimal strings. A repeated idempotency key returns the stored payment with HTTP 200 and `duplicate: true`. It is not a 409, because the original payment is the response.

### `POST /api/loans`

Request:

```json
{
  "principal": "200000.00",
  "annualInterestRate": "18",
  "tenureMonths": 24,
  "disbursementDate": "2024-01-15"
}
```

Success: HTTP 201.

```json
{
  "loan": {
    "id": "1",
    "principal": "200000.00",
    "annualInterestRate": "18.0000",
    "tenureMonths": 24,
    "disbursementDate": "2024-01-15",
    "createdAt": "2026-10-05T12:00:00.000Z"
  },
  "installments": [
    {
      "installmentNo": 1,
      "dueDate": "2024-02-15",
      "principalDue": "6984.82",
      "interestDue": "3000.00",
      "totalDue": "9984.82",
      "amountPaid": "0.00"
    }
  ],
  "position": {
    "outstandingPrincipal": "200000.00",
    "nextDueDate": "2024-02-15",
    "nextDueAmount": "9984.82",
    "overdueAmount": "0.00"
  }
}
```

`principalDue` and `interestDue` are the principal and interest components. `annualInterestRate` is stored at 4 decimal places. `nextDueDate` and `nextDueAmount` are `null` when every installment is fully paid.

### `GET /api/loans/:id`

Success: HTTP 200, with the same `loan`, `installments`, and `position` shape as create.

The position uses the server's local calendar date:

- Outstanding principal is the original principal minus principal already paid. Paid principal is the part of `amount_paid` left after outstanding interest is treated as paid first.
- Next due is the oldest installment that still has `total_due` greater than `amount_paid`. The amount is that unpaid balance.
- Overdue amount is the unpaid balance of installments whose due date is strictly before today. An installment due today is not overdue. No penalty or late fee is added.

### `POST /api/loans/:id/payments`

Request:

```json
{
  "amount": "5000.00",
  "paymentDate": "2024-03-05",
  "idempotencyKey": "unique-client-payment-reference"
}
```

First success: HTTP 201. The same loan id and idempotency key again: HTTP 200.

```json
{
  "payment": {
    "id": "1",
    "loanId": "1",
    "amount": "5000.00",
    "paymentDate": "2024-03-05",
    "idempotencyKey": "unique-client-payment-reference",
    "duplicate": false,
    "allocations": [
      {
        "installmentNo": 1,
        "interestAllocated": "3000.00",
        "principalAllocated": "2000.00",
        "amountAllocated": "5000.00",
        "amountPaid": "5000.00"
      }
    ],
    "installments": [
      { "installmentNo": 1, "amountPaid": "5000.00" }
    ]
  }
}
```

`installments` lists only the installments that payment changed. On a duplicate request, `duplicate` is `true` and the allocations are the stored ones.

### Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Principal must be a positive amount with at most 2 decimal places."
  }
}
```

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid JSON or invalid loan, payment, or id input |
| 401 | `UNAUTHENTICATED` | Reserved for Firebase verification |
| 404 | `LOAN_NOT_FOUND` | Unknown loan id |
| 422 | `PAYMENT_EXCEEDS_BALANCE` | Payment is larger than the remaining amount due |
| 500 | `INTERNAL_ERROR` | Unexpected failure. The database error is not returned |

## Tests

Unit tests, including schedule, money, allocation, and loan position:

```bash
npm test
```

Route tests against real PostgreSQL. `DATABASE_URL` is required. The database is not mocked. Set it in the environment or in `.env.local`, then run:

```bash
npm run test:integration
```

Those tests apply `db/schema.sql` and delete the loans they create.
