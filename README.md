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

`npm run db:seed` applies the same schema, then inserts three loans if those seed loans are not already present. Running it again reuses the same rows and the same partial payment. It prints each loan id. Set `NEXT_PUBLIC_SEEDED_LOAN_ID` to the overdue loan id from that output, then restart the app. That value is public and is different in each database, so it stays in the environment rather than in source.

| Seeded loan | ID | Purpose/state | What the evaluator should see |
| --- | --- | --- | --- |
| Current loan | Printed by `npm run db:seed` | ₹2,50,000 at 14% for 18 months, disbursed on the first day of the current month, no payments | Next installment is due today or later, and overdue amount is 0.00 |
| Overdue loan | Printed by `npm run db:seed`. This is the id for `NEXT_PUBLIC_SEEDED_LOAN_ID` | ₹1,80,000 at 18% for 12 months, disbursed 2024-03-15, no payments | Overdue amount is greater than 0.00, because the first installment was due 2024-04-15 and is still unpaid |
| Partially paid loan | Printed by `npm run db:seed` | ₹2,00,000 at 18% for 24 months, disbursed 2025-06-15, one payment of ₹5,000.00 on 2025-07-20 | Installment 1 is partly paid. The payment uses idempotency key `seed-partial-installment-v1` |

You can also export `DATABASE_URL` in the shell instead of using `.env.local`. The scripts load `.env.local` only when that file exists, and they do not override variables already set in the environment.

## Money and rounding

Amounts are integer paise inside the app and `NUMERIC(14, 2)` in Postgres. `node-pg` returns `NUMERIC` as a string, and the app does not convert those strings through JavaScript floating point.

The EMI formula is evaluated at 20 decimal places:

`EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)`, with `r = annual rate / 12 / 100`.

Each stored amount is rounded half up (away from zero at .5) to paise. Installments before the last use that rounded EMI. The final principal component is the remaining balance, so principal components sum to the original principal and the last installment carries the rounding remainder.

For ₹2,00,000 at 18% over 24 months, the rounded EMI is ₹9,984.82, which is within ₹2 of ₹9,986.

## API

Every loan and payment route calls `requireRequestUser` before it reads or writes data. The browser signs in with Firebase email/password, then sends `Authorization: Bearer <Firebase ID token>`. The server verifies that token with the Firebase Admin SDK. A missing, malformed, expired, or revoked token gets HTTP 401. The API does not accept a client-supplied user id, and loans are not owned by individual users.

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
| 401 | `UNAUTHENTICATED` | Missing or invalid Firebase ID token |
| 404 | `LOAN_NOT_FOUND` | Unknown loan id |
| 422 | `PAYMENT_EXCEEDS_BALANCE` | Payment is larger than the remaining amount due |
| 500 | `INTERNAL_ERROR` | Unexpected failure. The database error is not returned |

## Firebase Authentication

Create a Firebase project and enable the Email/Password sign-in provider.

1. In Firebase console, open Project settings and copy the web app config into the `NEXT_PUBLIC_FIREBASE_*` variables. Those values are visible in the browser.
2. Create a service account and download its JSON key. Put `project_id`, `client_email`, and `private_key` into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. Keep the private key on one line and replace real line breaks with `\n`. Do not prefix these with `NEXT_PUBLIC_`.
3. In Authentication, add an email/password user. That is the account used to sign in. For route integration tests, put the same email and password in `FIREBASE_TEST_EMAIL` and `FIREBASE_TEST_PASSWORD`. Those two variables are not used by the app.

Sign-in happens in the browser with the Firebase client SDK. `authorizedFetch` reads the current user's ID token and sends it as `Authorization: Bearer <token>`. `requireRequestUser` checks the header, then calls `verifyIdToken` with revocation checking. The returned user is only `uid` and `email` from that verified token.

The home page signs in with email and password, then opens the loan identified by `NEXT_PUBLIC_SEEDED_LOAN_ID`. That public id is the seeded loan the deployed UI shows. The page does not list every loan. After a payment, it requests that same loan again and replaces the schedule and position. It does not reload the browser.

## Tests

Unit tests, including schedule, money, allocation, loan position, authentication header checks, and the dashboard:

```bash
npm test
```

`npm test` does not call Firebase. It checks missing and malformed `Authorization` headers, including 401 responses from all three route handlers.

Route tests against real PostgreSQL:

```bash
npm run test:integration
```

`DATABASE_URL` is required. The database is not mocked. The tests apply `db/schema.sql` and delete the loans they create.

Unauthenticated requests to the three routes return 401 without Firebase credentials. Creating a loan, reading a loan, and recording a payment also require:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_TEST_EMAIL`
- `FIREBASE_TEST_PASSWORD`

Those authenticated cases are skipped until every variable above is set. The tests sign in with the Firebase client SDK and send the real ID token. They do not bypass `requireRequestUser`.
