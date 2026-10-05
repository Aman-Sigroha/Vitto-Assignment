import { configurePgTypes } from "../db.js";
import { HttpError } from "../http/errors.js";
import { moneyFromNumeric, moneyToNumeric } from "../money.js";
import { currentPosition, serverDate } from "./position.js";
import { buildRepaymentSchedule, normalizeAnnualInterestRate } from "./schedule.js";

export async function createLoan(pool, input, asOfDate = serverDate()) {
  configurePgTypes();
  const schedule = buildRepaymentSchedule({
    principal: input?.principal,
    annualInterestRate: input?.annualInterestRate,
    tenureMonths: input?.tenureMonths,
    disbursementDate: input?.disbursementDate,
  });
  const annualInterestRate = normalizeAnnualInterestRate(input.annualInterestRate);
  const principal = moneyToNumeric(input.principal);

  const client = await pool.connect();
  let started = false;
  try {
    await client.query("BEGIN");
    started = true;
    const inserted = await client.query(
      `INSERT INTO loans (principal, annual_interest_rate, tenure_months, disbursement_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, principal, annual_interest_rate, tenure_months, disbursement_date, created_at`,
      [principal, annualInterestRate, input.tenureMonths, input.disbursementDate],
    );
    const loanId = inserted.rows[0].id;

    for (const installment of schedule) {
      await client.query(
        `INSERT INTO installments (
           loan_id, installment_no, due_date, principal_due, interest_due, total_due, amount_paid
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          loanId,
          installment.installmentNo,
          installment.dueDate,
          installment.principalDue,
          installment.interestDue,
          installment.totalDue,
          installment.amountPaid,
        ],
      );
    }

    await client.query("COMMIT");
    started = false;
    return presentLoan(inserted.rows[0], schedule, asOfDate);
  } catch (error) {
    if (started) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getLoan(pool, loanId, asOfDate = serverDate()) {
  configurePgTypes();
  const id = parseLoanId(loanId);
  const client = await pool.connect();
  let started = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    started = true;
    const loan = await client.query(
      `SELECT id, principal, annual_interest_rate, tenure_months, disbursement_date, created_at
       FROM loans
       WHERE id = $1`,
      [id],
    );
    if (loan.rowCount === 0) {
      throw new HttpError(404, "LOAN_NOT_FOUND", "Loan not found.");
    }

    const installments = await client.query(
      `SELECT installment_no, due_date, principal_due, interest_due, total_due, amount_paid
       FROM installments
       WHERE loan_id = $1
       ORDER BY installment_no`,
      [id],
    );
    await client.query("COMMIT");
    started = false;
    return presentLoan(loan.rows[0], installments.rows.map(mapInstallmentRow), asOfDate);
  } catch (error) {
    if (started) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function presentLoan(row, installments, asOfDate) {
  const loan = {
    id: String(row.id),
    principal: moneyFromNumeric(row.principal),
    annualInterestRate: normalizeAnnualInterestRate(String(row.annual_interest_rate)),
    tenureMonths: Number(row.tenure_months),
    disbursementDate: dateString(row.disbursement_date),
    createdAt: timestampString(row.created_at),
  };

  return {
    loan,
    installments,
    position: currentPosition(loan.principal, installments, asOfDate),
  };
}

function mapInstallmentRow(row) {
  return {
    installmentNo: Number(row.installment_no),
    dueDate: dateString(row.due_date),
    principalDue: moneyFromNumeric(row.principal_due),
    interestDue: moneyFromNumeric(row.interest_due),
    totalDue: moneyFromNumeric(row.total_due),
    amountPaid: moneyFromNumeric(row.amount_paid),
  };
}

function parseLoanId(value) {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new Error("Loan id must be a positive integer.");
}

function dateString(value) {
  if (typeof value === "string") return value.slice(0, 10);
  throw new Error("Expected a date string from PostgreSQL.");
}

function timestampString(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
