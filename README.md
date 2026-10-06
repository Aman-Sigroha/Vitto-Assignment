# Vitto Loan Repayment Service

Next.js application for the Vitto MSME loan repayment assessment.

**Live deployment:** [https://vitto-assignment-loan.vercel.app/](https://vitto-assignment-loan.vercel.app/)

## What is included

- Firebase Email/Password authentication with server-side ID-token verification
- PostgreSQL loan, installment, payment, and payment-allocation persistence
- EMI schedule generation with final-installment remainder handling
- Transactional payment allocation with idempotency
- Current position, next due amount, and overdue amount
- React dashboard that refreshes loan state after a payment without a browser reload



## Run locally

```bash
npm install
cp .env.example .env.local
```

Set the required environment variables in `.env.local`, then initialize and seed the database:

```bash
npm run db:setup
npm run db:seed
```

`npm run db:seed` prints the seeded loan ids. For the local UI, set `NEXT_PUBLIC_SEEDED_LOAN_ID` to the overdue loan id and restart the app.

Start development:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production build:

```bash
npm run build
npm start
```



## Database

Production uses hosted PostgreSQL (Neon). The app uses the `pg` package and plain SQL; database credentials are never stored in source.

`db/schema.sql` creates `loans`, `installments`, `payments`, and `payment_allocations`. The schema is safe to apply repeatedly. `payments.loan_id` has a foreign key to `loans.id`. Money columns use PostgreSQL `NUMERIC(14, 2)`.

The seed creates three deterministic loans and reuses the same rows/payment when run again:


| Loan           | Production ID | State   | Details                                                                   |
| -------------- | ------------- | ------- | ------------------------------------------------------------------------- |
| Current        | 7             | Current | ₹2,50,000 at 14% for 18 months; no payments                               |
| Overdue        | 9             | Overdue | ₹1,80,000 at 18% for 12 months; disbursed 2024-03-15; unpaid installments |
| Partially paid | 11            | Partial | ₹2,00,000 at 18% for 24 months; ₹5,000 payment on 2025-07-20              |


The deployed UI uses `NEXT_PUBLIC_SEEDED_LOAN_ID=9`, so the evaluator lands on the overdue loan.

## Money, EMI, and rounding

Amounts are integer paise inside application logic and `NUMERIC(14, 2)` in PostgreSQL. `pg` returns PostgreSQL `NUMERIC` values as strings; the app does not route money through JavaScript floating point.

EMI is calculated as:

`EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)`, where `r = annual rate / 12 / 100`.

The internal EMI calculation uses 20 decimal places. Stored amounts use half-up rounding to paise. Every installment before the last uses the rounded EMI; the final principal component is the remaining principal balance, so principal components sum exactly to the original principal.

For ₹2,00,000 at 18% over 24 months, the rounded EMI is ₹9,984.82, within ₹2 of the assignment's approximately ₹9,986 example.

## Payment allocation

Payments are allocated to the **oldest unpaid installment first**. Within an installment, payment is applied to **interest first, then principal**. A payment may span multiple installments when the amount is sufficient.

A payment larger than the remaining balance is rejected with `422 PAYMENT_EXCEEDS_BALANCE`; there is no unapplied credit balance. Payments use an idempotency key. Repeating the same loan id + key returns the original payment with HTTP 200 and `duplicate: true` instead of creating another payment.

Payments are processed in a database transaction and installment rows are locked while allocation is performed.

Late payments do not accrue penalty interest or late fees. Overdue amount is the unpaid balance of installments whose due date is strictly before the server's local calendar date; an installment due today is not overdue.

## API

All three routes require `Authorization: Bearer <Firebase ID token>`. The server verifies the token with Firebase Admin. Missing, malformed, expired, or revoked tokens return `401 UNAUTHENTICATED`. The API does not accept a client-supplied user id, and loans are not user-owned.

### `POST /api/loans`

Creates a loan and its full installment schedule.

```json
{
  "principal": "200000.00",
  "annualInterestRate": "18",
  "tenureMonths": 24,
  "disbursementDate": "2024-01-15"
}
```

Success: `201`.

### `GET /api/loans/:id`

Returns the loan, installment schedule, and current position:

- `outstandingPrincipal`
- `nextDueDate`
- `nextDueAmount`
- `overdueAmount`

Success: `200`.

### `POST /api/loans/:id/payments`

Records and allocates a payment.

```json
{
  "amount": "5000.00",
  "paymentDate": "2024-03-05",
  "idempotencyKey": "unique-client-payment-reference"
}
```

First submission: `201`. Repeated submission with the same idempotency key for the same loan: `200` with `duplicate: true`.

### Error responses


| Status | Code                      | Meaning                               |
| ------ | ------------------------- | ------------------------------------- |
| 400    | `VALIDATION_ERROR`        | Invalid JSON or loan/payment/id input |
| 401    | `UNAUTHENTICATED`         | Missing or invalid Firebase ID token  |
| 404    | `LOAN_NOT_FOUND`          | Unknown loan id                       |
| 422    | `PAYMENT_EXCEEDS_BALANCE` | Payment exceeds the remaining balance |
| 500    | `INTERNAL_ERROR`          | Unexpected server failure             |




## Firebase authentication

Enable Email/Password sign-in in Firebase.

Client variables:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`

Server variables:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

For integration tests, also set `FIREBASE_TEST_EMAIL` and `FIREBASE_TEST_PASSWORD` to a Firebase Email/Password test account. These test-only variables are not used by the deployed application.

The browser signs in through the Firebase client SDK. `authorizedFetch` obtains the current user's ID token and sends it as a Bearer token. The server calls Firebase Admin `verifyIdToken` with revocation checking before accessing loan/payment data.

## Tests

Full local test suite:

```bash
npm run test:all
```

Individual commands:

```bash
npm test
npm run test:integration
npm run build
```

`npm test` covers money, schedule generation, payment allocation, loan position, authentication guards, API behavior, and the dashboard. `npm run test:integration` runs route and seed tests against real PostgreSQL (not a mocked database). Authenticated integration cases use a real Firebase ID token.

GitHub Actions runs the test suite, PostgreSQL integration tests, and production build on every push and pull request.