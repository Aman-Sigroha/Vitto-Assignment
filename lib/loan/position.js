import { describeInstallmentBalance } from "./payment.js";
import { formatMoney, parseMoney } from "../money.js";

// Outstanding principal subtracts only the principal portion of amount_paid.
// That portion is interest-first, the same rule used when a payment is allocated.
// Overdue amount is the unpaid balance of installments due strictly before asOfDate.
// An installment due on asOfDate is not overdue. No penalty or late fee is added.

export function currentPosition(principal, installments, asOfDate) {
  if (typeof asOfDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error("As-of date must be YYYY-MM-DD.");
  }

  const ordered = [...installments].sort((left, right) => left.installmentNo - right.installmentNo);
  let principalPaid = 0n;
  let overdue = 0n;
  let nextDueDate = null;
  let nextDueAmount = null;

  for (const installment of ordered) {
    const balance = describeInstallmentBalance(installment);
    principalPaid += parseMoney(balance.principalPaid);
    const unpaid = parseMoney(balance.unpaidAmount);

    if (unpaid > 0n && nextDueDate === null) {
      nextDueDate = installment.dueDate;
      nextDueAmount = balance.unpaidAmount;
    }
    if (unpaid > 0n && installment.dueDate < asOfDate) {
      overdue += unpaid;
    }
  }

  return {
    outstandingPrincipal: formatMoney(parseMoney(principal) - principalPaid),
    nextDueDate,
    nextDueAmount,
    overdueAmount: formatMoney(overdue),
  };
}

export function serverDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
