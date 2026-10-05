import { configurePgTypes } from "../db.js";
import { addMoney, formatMoney, moneyFromNumeric, parseMoney } from "../money.js";

// Oldest installment first. Within an installment, unpaid interest is covered
// before unpaid principal. amount_paid never exceeds total_due. Any paise that
// cannot fit on the remaining schedule are returned as unallocatedAmount.
// The payment date does not change interest.

export function calculateAllocation(installments, paymentAmount) {
  const paymentPaise = parsePaymentAmount(paymentAmount);
  const ordered = orderedInstallments(installments);
  let remaining = paymentPaise;
  const allocations = [];
  const amountPaidByNumber = new Map();

  for (const installment of ordered) {
    if (remaining === 0n) break;

    const outstanding = splitOutstanding(installment);
    const unpaid = outstanding.remainingInterest + outstanding.remainingPrincipal;
    if (unpaid === 0n) continue;

    const interestAllocated = minBigInt(remaining, outstanding.remainingInterest);
    remaining -= interestAllocated;
    const principalAllocated = minBigInt(remaining, outstanding.remainingPrincipal);
    remaining -= principalAllocated;

    const applied = interestAllocated + principalAllocated;
    const amountPaid = outstanding.amountPaid + applied;
    amountPaidByNumber.set(installment.installmentNo, amountPaid);
    allocations.push({
      installmentNo: installment.installmentNo,
      interestAllocated: formatMoney(interestAllocated),
      principalAllocated: formatMoney(principalAllocated),
      amountAllocated: formatMoney(applied),
      amountPaid: formatMoney(amountPaid),
    });
  }

  return {
    installments: ordered.map((installment) => ({
      ...installment,
      amountPaid: amountPaidByNumber.has(installment.installmentNo)
        ? formatMoney(amountPaidByNumber.get(installment.installmentNo))
        : installment.amountPaid,
    })),
    allocations,
    unallocatedAmount: formatMoney(remaining),
  };
}

export function allocatePayment(installments, paymentAmount) {
  const allocation = calculateAllocation(installments, paymentAmount);
  if (parseMoney(allocation.unallocatedAmount) > 0n) {
    throw new Error("Payment exceeds the remaining amount due on the loan.");
  }
  return allocation;
}

export function resultForExistingPayment(recordedPayment) {
  return {
    paymentId: recordedPayment.paymentId,
    loanId: recordedPayment.loanId,
    amount: recordedPayment.amount,
    paymentDate: recordedPayment.paymentDate,
    idempotencyKey: recordedPayment.idempotencyKey,
    duplicate: true,
    allocations: recordedPayment.allocations.map((entry) => ({ ...entry })),
    installments: recordedPayment.allocations.map((entry) => ({
      installmentNo: entry.installmentNo,
      amountPaid: entry.amountPaid,
    })),
  };
}

export async function recordPayment(pool, input) {
  configurePgTypes();
  const loanId = parseLoanId(input.loanId);
  const amount = formatMoney(parsePaymentAmount(input.amount));
  const paymentDate = parseIsoDate(input.paymentDate, "Payment date");
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);

  const client = await pool.connect();
  let started = false;
  try {
    await client.query("BEGIN");
    started = true;
    const result = await persistPayment(client, {
      loanId,
      amount,
      paymentDate,
      idempotencyKey,
    });
    await client.query("COMMIT");
    started = false;
    return result;
  } catch (error) {
    if (started) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function persistPayment(client, { loanId, amount, paymentDate, idempotencyKey }) {
  const loan = await client.query("SELECT id FROM loans WHERE id = $1 FOR UPDATE", [loanId]);
  if (loan.rowCount === 0) {
    throw new Error("Loan not found.");
  }

  const existing = await loadExistingPayment(client, loanId, idempotencyKey);
  if (existing) {
    return resultForExistingPayment(existing);
  }

  const locked = await client.query(
    `SELECT id, installment_no, principal_due, interest_due, total_due, amount_paid
     FROM installments
     WHERE loan_id = $1
     ORDER BY installment_no
     FOR UPDATE`,
    [loanId],
  );
  if (locked.rowCount === 0) {
    throw new Error("Loan has no installments.");
  }

  const allocation = allocatePayment(locked.rows.map(mapInstallmentRow), amount);
  const payment = await insertPayment(client, { loanId, amount, paymentDate, idempotencyKey });
  if (payment.duplicate) {
    const raced = await loadExistingPayment(client, loanId, idempotencyKey);
    if (!raced) {
      throw new Error("Payment idempotency key conflicted, but the stored payment was not found.");
    }
    return resultForExistingPayment(raced);
  }

  const rowsByNumber = new Map(locked.rows.map((row) => [Number(row.installment_no), row]));
  for (const entry of allocation.allocations) {
    const installment = rowsByNumber.get(entry.installmentNo);
    await client.query("UPDATE installments SET amount_paid = $1 WHERE id = $2", [
      entry.amountPaid,
      installment.id,
    ]);
    await client.query(
      `INSERT INTO payment_allocations (
         payment_id, installment_id, interest_allocated, principal_allocated, amount_paid_after
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        payment.row.id,
        installment.id,
        entry.interestAllocated,
        entry.principalAllocated,
        entry.amountPaid,
      ],
    );
  }

  return {
    paymentId: String(payment.row.id),
    loanId: String(payment.row.loan_id),
    amount: moneyFromNumeric(payment.row.amount),
    paymentDate: payment.row.payment_date,
    idempotencyKey: payment.row.idempotency_key,
    duplicate: false,
    allocations: allocation.allocations,
    installments: allocation.allocations.map((entry) => ({
      installmentNo: entry.installmentNo,
      amountPaid: entry.amountPaid,
    })),
  };
}

async function insertPayment(client, { loanId, amount, paymentDate, idempotencyKey }) {
  await client.query("SAVEPOINT payment_insert");
  try {
    const inserted = await client.query(
      `INSERT INTO payments (loan_id, amount, payment_date, idempotency_key)
       VALUES ($1, $2, $3, $4)
       RETURNING id, loan_id, amount, payment_date, idempotency_key`,
      [loanId, amount, paymentDate, idempotencyKey],
    );
    await client.query("RELEASE SAVEPOINT payment_insert");
    return { duplicate: false, row: inserted.rows[0] };
  } catch (error) {
    if (error.code !== "23505") throw error;
    await client.query("ROLLBACK TO SAVEPOINT payment_insert");
    return { duplicate: true, row: null };
  }
}

async function loadExistingPayment(client, loanId, idempotencyKey) {
  const payment = await client.query(
    `SELECT id, loan_id, amount, payment_date, idempotency_key
     FROM payments
     WHERE loan_id = $1 AND idempotency_key = $2`,
    [loanId, idempotencyKey],
  );
  if (payment.rowCount === 0) return null;

  const allocations = await client.query(
    `SELECT i.installment_no, a.interest_allocated, a.principal_allocated, a.amount_paid_after
     FROM payment_allocations a
     JOIN installments i ON i.id = a.installment_id
     WHERE a.payment_id = $1
     ORDER BY i.installment_no`,
    [payment.rows[0].id],
  );
  const row = payment.rows[0];
  return {
    paymentId: String(row.id),
    loanId: String(row.loan_id),
    amount: moneyFromNumeric(row.amount),
    paymentDate: row.payment_date,
    idempotencyKey: row.idempotency_key,
    allocations: allocations.rows.map(mapAllocationRow),
  };
}

function mapInstallmentRow(row) {
  return {
    installmentNo: Number(row.installment_no),
    principalDue: moneyFromNumeric(row.principal_due),
    interestDue: moneyFromNumeric(row.interest_due),
    totalDue: moneyFromNumeric(row.total_due),
    amountPaid: moneyFromNumeric(row.amount_paid),
  };
}

function mapAllocationRow(row) {
  const interestAllocated = moneyFromNumeric(row.interest_allocated);
  const principalAllocated = moneyFromNumeric(row.principal_allocated);
  return {
    installmentNo: Number(row.installment_no),
    interestAllocated,
    principalAllocated,
    amountAllocated: addMoney(interestAllocated, principalAllocated),
    amountPaid: moneyFromNumeric(row.amount_paid_after),
  };
}

function orderedInstallments(installments) {
  if (!Array.isArray(installments) || installments.length === 0) {
    throw new Error("At least one installment is required.");
  }

  const ordered = [...installments].sort((left, right) => left.installmentNo - right.installmentNo);
  for (let index = 0; index < ordered.length; index += 1) {
    const installmentNo = ordered[index].installmentNo;
    if (!Number.isInteger(installmentNo) || installmentNo <= 0) {
      throw new Error("Installment number must be a positive whole number.");
    }
    if (index > 0 && installmentNo === ordered[index - 1].installmentNo) {
      throw new Error("Installment numbers must be unique.");
    }
  }
  return ordered;
}

function splitOutstanding(installment) {
  const principalDue = parseMoney(installment.principalDue);
  const interestDue = parseMoney(installment.interestDue);
  const totalDue = parseMoney(installment.totalDue);
  const amountPaid = parseMoney(installment.amountPaid);

  if (principalDue + interestDue !== totalDue) {
    throw new Error("Installment total due must equal principal due plus interest due.");
  }
  if (amountPaid > totalDue) {
    throw new Error("Installment amount paid cannot exceed total due.");
  }

  const interestPaid = minBigInt(amountPaid, interestDue);
  return {
    amountPaid,
    remainingInterest: interestDue - interestPaid,
    remainingPrincipal: principalDue - (amountPaid - interestPaid),
  };
}

function parsePaymentAmount(value) {
  let paise;
  try {
    paise = parseMoney(value);
  } catch (error) {
    throw new Error(
      `Payment amount must be a positive amount with at most 2 decimal places. ${error.message}`,
    );
  }
  if (paise <= 0n) {
    throw new Error("Payment amount must be a positive amount with at most 2 decimal places.");
  }
  return paise;
}

function parseLoanId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  throw new Error("Loan id must be a positive integer.");
}

function parseIdempotencyKey(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Idempotency key is required.");
  }
  return value;
}

function parseIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a valid calendar date in YYYY-MM-DD form.`);
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  const valid = utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day;
  if (!valid) {
    throw new Error(`${label} must be a valid calendar date in YYYY-MM-DD form.`);
  }
  return value;
}

function minBigInt(left, right) {
  return left < right ? left : right;
}
