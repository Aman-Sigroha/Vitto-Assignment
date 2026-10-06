import { buildRepaymentSchedule } from "../lib/loan/schedule.js";

// These three loans are the deployment seed. Identity is the loan terms below,
// not a database id, so the same rows can be found in every environment.
// The current loan's disbursement is the first day of the month containing
// `today`, which keeps its first installment due on or after that day.
// The overdue loan is disbursed on a fixed past date and is left unpaid.
const CURRENT_LOAN = {
  key: "current",
  label: "Current loan",
  dashboard: false,
  principal: "250000.00",
  annualInterestRate: "14",
  tenureMonths: 18,
};

const OVERDUE_LOAN = {
  key: "overdue",
  label: "Overdue loan",
  dashboard: true,
  principal: "180000.00",
  annualInterestRate: "18",
  tenureMonths: 12,
  disbursementDate: "2024-03-15",
};

const PARTIAL_LOAN = {
  key: "partial",
  label: "Partially paid loan",
  dashboard: false,
  principal: "200000.00",
  annualInterestRate: "18",
  tenureMonths: 24,
  disbursementDate: "2025-06-15",
  payment: {
    amount: "5000.00",
    paymentDate: "2025-07-20",
    idempotencyKey: "seed-partial-installment-v1",
  },
};

export function resolveSeedLoans(today) {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error("Seed date must be YYYY-MM-DD.");
  }

  const loans = [
    { ...CURRENT_LOAN, disbursementDate: `${today.slice(0, 8)}01` },
    { ...OVERDUE_LOAN },
    {
      ...PARTIAL_LOAN,
      payment: { ...PARTIAL_LOAN.payment },
    },
  ];

  for (const loan of loans) {
    const schedule = buildRepaymentSchedule(loan);
    if (schedule.length !== loan.tenureMonths) {
      throw new Error(`Seed loan ${loan.key} did not build a full schedule.`);
    }
  }

  return loans;
}
