import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { POST as createLoanRoute } from "../app/api/loans/route.js";
import { GET as getLoanRoute } from "../app/api/loans/[id]/route.js";
import { POST as recordPaymentRoute } from "../app/api/loans/[id]/payments/route.js";
import { applySchema } from "../db/apply-schema.js";
import { closePool, getPool } from "../lib/db.js";
import { addMoney, subtractMoney } from "../lib/money.js";
import { serverDate } from "../lib/loan/position.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for route integration tests. These tests do not mock PostgreSQL.");
}

const FIREBASE_TEST_ENV = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_TEST_EMAIL",
  "FIREBASE_TEST_PASSWORD",
];

const missingFirebaseEnv = FIREBASE_TEST_ENV.filter((name) => !process.env[name]);
const skipWithoutFirebase = missingFirebaseEnv.length === 0
  ? false
  : `Set ${missingFirebaseEnv.join(", ")} to run authenticated route tests.`;

const createdLoanIds = [];
let testToken;

function loanContext(id) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function jsonRequest(url, body, { token = testToken } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function authedGet(url) {
  return new Request(url, {
    headers: { authorization: `Bearer ${testToken}` },
  });
}

async function createExampleLoan() {
  const response = await createLoanRoute(jsonRequest("http://localhost/api/loans", {
    principal: "200000.00",
    annualInterestRate: "18",
    tenureMonths: 24,
    disbursementDate: "2024-01-15",
  }));
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  createdLoanIds.push(body.loan.id);
  return body;
}

describe("loan and payment routes against PostgreSQL", () => {
  before(async () => {
    await applySchema(getPool());
    if (missingFirebaseEnv.length === 0) {
      testToken = await signInTestUser();
    }
  });

  after(async () => {
    if (createdLoanIds.length > 0) {
      const pool = getPool();
      await pool.query(
        `DELETE FROM payment_allocations
         WHERE installment_id IN (SELECT id FROM installments WHERE loan_id = ANY($1::bigint[]))`,
        [createdLoanIds],
      );
      await pool.query("DELETE FROM payments WHERE loan_id = ANY($1::bigint[])", [createdLoanIds]);
      await pool.query("DELETE FROM installments WHERE loan_id = ANY($1::bigint[])", [createdLoanIds]);
      await pool.query("DELETE FROM loans WHERE id = ANY($1::bigint[])", [createdLoanIds]);
    }
    await closePool();
  });

  it("rejects unauthenticated requests to every loan route", async () => {
    const created = await createLoanRoute(jsonRequest("http://localhost/api/loans", {
      principal: "200000.00",
      annualInterestRate: "18",
      tenureMonths: 24,
      disbursementDate: "2024-01-15",
    }, { token: null }));
    assert.equal(created.status, 401);
    assert.equal((await created.json()).error.code, "UNAUTHENTICATED");

    const loaded = await getLoanRoute(
      new Request("http://localhost/api/loans/1"),
      loanContext("1"),
    );
    assert.equal(loaded.status, 401);
    assert.equal((await loaded.json()).error.code, "UNAUTHENTICATED");

    const paid = await recordPaymentRoute(
      jsonRequest("http://localhost/api/loans/1/payments", {
        amount: "5000.00",
        paymentDate: "2024-03-05",
        idempotencyKey: "missing-token",
      }, { token: null }),
      loanContext("1"),
    );
    assert.equal(paid.status, 401);
    assert.equal((await paid.json()).error.code, "UNAUTHENTICATED");
  });

  it("creates a loan and its full schedule", { skip: skipWithoutFirebase }, async () => {
    const body = await createExampleLoan();
    assert.equal(body.loan.principal, "200000.00");
    assert.equal(body.loan.annualInterestRate, "18.0000");
    assert.equal(body.loan.tenureMonths, 24);
    assert.equal(body.loan.disbursementDate, "2024-01-15");
    assert.equal(body.installments.length, 24);
    assert.equal(body.installments[0].installmentNo, 1);
    assert.equal(body.installments[0].dueDate, "2024-02-15");
    assert.equal(body.installments[0].principalDue, "6984.82");
    assert.equal(body.installments[0].interestDue, "3000.00");
    assert.equal(body.installments[0].totalDue, "9984.82");
    assert.equal(body.installments[0].amountPaid, "0.00");
    assert.equal(body.position.outstandingPrincipal, "200000.00");
    assert.equal(body.position.nextDueDate, "2024-02-15");
    assert.equal(body.position.nextDueAmount, "9984.82");
    assert.equal(body.position.overdueAmount, overdueFrom(body.installments, serverDate()));
  });

  it("returns 404 for an unknown loan", { skip: skipWithoutFirebase }, async () => {
    const response = await getLoanRoute(
      authedGet("http://localhost/api/loans/9223372036854775806"),
      loanContext("9223372036854775806"),
    );
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      error: { code: "LOAN_NOT_FOUND", message: "Loan not found." },
    });
  });

  it("returns a validation error for an invalid loan and does not require a successful insert", { skip: skipWithoutFirebase }, async () => {
    const response = await createLoanRoute(jsonRequest("http://localhost/api/loans", {
      principal: "0.00",
      annualInterestRate: "18",
      tenureMonths: 0,
      disbursementDate: "2024-01-15",
    }));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.match(body.error.message, /Principal must be a positive amount/);
  });

  it("records a payment, then returns the original result for the same idempotency key", { skip: skipWithoutFirebase }, async () => {
    const created = await createExampleLoan();
    const idempotencyKey = `pay-${randomUUID()}`;
    const paymentBody = {
      amount: "5000.00",
      paymentDate: "2024-03-05",
      idempotencyKey,
    };

    const first = await recordPaymentRoute(
      jsonRequest(`http://localhost/api/loans/${created.loan.id}/payments`, paymentBody),
      loanContext(created.loan.id),
    );
    const firstBody = await first.json();
    assert.equal(first.status, 201, JSON.stringify(firstBody));
    assert.equal(firstBody.payment.duplicate, false);
    assert.equal(firstBody.payment.amount, "5000.00");
    assert.equal(firstBody.payment.allocations[0].interestAllocated, "3000.00");
    assert.equal(firstBody.payment.allocations[0].principalAllocated, "2000.00");

    const second = await recordPaymentRoute(
      jsonRequest(`http://localhost/api/loans/${created.loan.id}/payments`, paymentBody),
      loanContext(created.loan.id),
    );
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.payment.duplicate, true);
    assert.equal(secondBody.payment.id, firstBody.payment.id);
    assert.equal(secondBody.payment.amount, "5000.00");
    assert.deepEqual(secondBody.payment.allocations, firstBody.payment.allocations);

    const loaded = await getLoanRoute(
      authedGet(`http://localhost/api/loans/${created.loan.id}`),
      loanContext(created.loan.id),
    );
    const loadedBody = await loaded.json();
    assert.equal(loaded.status, 200);
    assert.equal(loadedBody.installments[0].amountPaid, "5000.00");
    assert.equal(loadedBody.installments[1].amountPaid, "0.00");
    assert.equal(loadedBody.position.outstandingPrincipal, "198000.00");
    assert.equal(
      loadedBody.position.overdueAmount,
      overdueFrom(loadedBody.installments, serverDate()),
    );
  });

  it("rejects an invalid payment without changing the schedule", { skip: skipWithoutFirebase }, async () => {
    const created = await createExampleLoan();
    const response = await recordPaymentRoute(
      jsonRequest(`http://localhost/api/loans/${created.loan.id}/payments`, {
        amount: "-5.00",
        paymentDate: "2024-03-05",
        idempotencyKey: `bad-${randomUUID()}`,
      }),
      loanContext(created.loan.id),
    );
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "VALIDATION_ERROR");
    assert.match(body.error.message, /Payment amount/);

    const loaded = await getLoanRoute(
      authedGet(`http://localhost/api/loans/${created.loan.id}`),
      loanContext(created.loan.id),
    );
    const loadedBody = await loaded.json();
    assert.equal(loadedBody.installments[0].amountPaid, "0.00");
    assert.equal(loadedBody.position.outstandingPrincipal, "200000.00");
  });
});

async function signInTestUser() {
  const { getApp, getApps, initializeApp } = await import("firebase/app");
  const { getAuth, signInWithEmailAndPassword } = await import("firebase/auth");
  const app = getApps().length > 0
    ? getApp()
    : initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  const credential = await signInWithEmailAndPassword(
    getAuth(app),
    process.env.FIREBASE_TEST_EMAIL,
    process.env.FIREBASE_TEST_PASSWORD,
  );
  return credential.user.getIdToken();
}

function overdueFrom(installments, asOfDate) {
  return installments.reduce((total, installment) => {
    if (installment.dueDate >= asOfDate) return total;
    return addMoney(total, subtractMoney(installment.totalDue, installment.amountPaid));
  }, "0.00");
}
