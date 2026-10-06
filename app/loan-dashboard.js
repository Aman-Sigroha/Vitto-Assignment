"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthPanel } from "./auth-panel";
import { useAuth } from "./auth-provider";
import { authorizedFetch } from "../lib/api-client";
import { compareMoney, subtractMoney } from "../lib/money";

export function LoanDashboard({
  loanId = process.env.NEXT_PUBLIC_SEEDED_LOAN_ID,
  request = authorizedFetch,
}) {
  const auth = useAuth();
  const [sessionMessage, setSessionMessage] = useState("");
  const userId = auth.user?.uid ?? null;
  const [seenUserId, setSeenUserId] = useState(userId);

  if (userId !== seenUserId) {
    setSeenUserId(userId);
    if (userId) setSessionMessage("");
  }

  const handleUnauthenticated = useCallback((message) => {
    setSessionMessage(message);
    auth.signOut();
  }, [auth]);

  return (
    <>
      <AuthPanel />
      {sessionMessage ? <p role="alert">{sessionMessage}</p> : null}
      {auth.user ? (
        <LoanWorkspace
          loanId={loanId}
          request={request}
          onUnauthenticated={handleUnauthenticated}
        />
      ) : null}
    </>
  );
}

function LoanWorkspace({ loanId, request, onUnauthenticated }) {
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(Boolean(loanId));
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [submitting, setSubmitting] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    if (!loanId) return undefined;

    let ignore = false;
    readApi(request, `/api/loans/${loanId}`)
      .then((body) => {
        if (!ignore) setLoan(body);
      })
      .catch((loadError) => {
        if (ignore) return;
        if (loadError.status === 401) {
          onUnauthenticated(loadError.message);
          return;
        }
        setError(loadError.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [loanId, request, onUnauthenticated]);

  if (!loanId) {
    return <p role="status">Set NEXT_PUBLIC_SEEDED_LOAN_ID to open the seeded loan.</p>;
  }

  if (loading) {
    return <p role="status">Loading loan.</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!loan) return null;

  const { position } = loan;
  const overdue = compareMoney(position.overdueAmount, "0.00") > 0;
  const settled = position.nextDueDate == null;

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setPaymentError("");
    setPaymentMessage("");
    try {
      const body = await readApi(request, `/api/loans/${loanId}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount,
          paymentDate,
          idempotencyKey,
        }),
      });
      const payment = body.payment;
      setPaymentMessage(payment.duplicate
        ? "This payment was already recorded."
        : `Recorded payment ${payment.amount} on ${payment.paymentDate}.`);
      setAmount("");
      setIdempotencyKey(newIdempotencyKey());
      const refreshed = await readApi(request, `/api/loans/${loanId}`);
      setLoan(refreshed);
    } catch (submitError) {
      if (submitError.status === 401) {
        onUnauthenticated(submitError.message);
        return;
      }
      setPaymentError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="loan">
      <h2>Loan {loan.loan.id}</h2>
      <p>
        Principal {loan.loan.principal}
        {" · "}
        {loan.loan.annualInterestRate}% annual
        {" · "}
        {loan.loan.tenureMonths} months
        {" · "}
        Disbursed {loan.loan.disbursementDate}
      </p>

      <dl className="position">
        <div>
          <dt>Outstanding principal</dt>
          <dd>{position.outstandingPrincipal}</dd>
        </div>
        <div>
          <dt>Next due date</dt>
          <dd>{position.nextDueDate ?? "None"}</dd>
        </div>
        <div>
          <dt>Next due amount</dt>
          <dd>{position.nextDueAmount ?? "None"}</dd>
        </div>
        <div className={overdue ? "overdue" : undefined}>
          <dt>Overdue amount</dt>
          <dd>{position.overdueAmount}</dd>
        </div>
      </dl>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Installment</th>
              <th>Due Date</th>
              <th>Principal</th>
              <th>Interest</th>
              <th>Total Due</th>
              <th>Amount Paid</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {loan.installments.map((installment) => (
              <tr key={installment.installmentNo}>
                <td>{installment.installmentNo}</td>
                <td>{installment.dueDate}</td>
                <td>{installment.principalDue}</td>
                <td>{installment.interestDue}</td>
                <td>{installment.totalDue}</td>
                <td>{installment.amountPaid}</td>
                <td>{subtractMoney(installment.totalDue, installment.amountPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {settled ? <p role="status">No remaining balance.</p> : null}
      {paymentMessage ? <p role="status">{paymentMessage}</p> : null}
      {paymentError ? <p role="alert">{paymentError}</p> : null}

      {settled ? null : (
        <form onSubmit={onSubmit}>
          <h2>Record a payment</h2>
          <label>
            Amount
            <input
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label>
            Payment date
            <input
              name="paymentDate"
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
              required
            />
          </label>
          <label>
            Idempotency key
            <input name="idempotencyKey" value={idempotencyKey} readOnly />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? "Recording payment..." : "Record payment"}
          </button>
        </form>
      )}
    </section>
  );
}

async function readApi(request, url, options) {
  const response = await request(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = new Error(body?.error?.message || "The request failed.");
    error.status = response.status;
    throw error;
  }

  return body;
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function newIdempotencyKey() {
  return crypto.randomUUID();
}
