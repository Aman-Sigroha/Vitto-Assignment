import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentPosition } from "../lib/loan/position.js";

const INSTALLMENTS = [
  {
    installmentNo: 1,
    dueDate: "2024-02-15",
    principalDue: "80.00",
    interestDue: "20.00",
    totalDue: "100.00",
    amountPaid: "30.00",
  },
  {
    installmentNo: 2,
    dueDate: "2024-03-15",
    principalDue: "90.00",
    interestDue: "10.00",
    totalDue: "100.00",
    amountPaid: "0.00",
  },
];

describe("loan position", () => {
  it("subtracts paid principal, picks the oldest unpaid installment, and sums overdue balances", () => {
    const beforeSecondDue = currentPosition("170.00", INSTALLMENTS, "2024-03-01");
    assert.equal(beforeSecondDue.outstandingPrincipal, "160.00");
    assert.equal(beforeSecondDue.nextDueDate, "2024-02-15");
    assert.equal(beforeSecondDue.nextDueAmount, "70.00");
    assert.equal(beforeSecondDue.overdueAmount, "70.00");

    const onFirstDueDate = currentPosition("170.00", INSTALLMENTS, "2024-02-15");
    assert.equal(onFirstDueDate.overdueAmount, "0.00");
    assert.equal(onFirstDueDate.nextDueDate, "2024-02-15");

    const afterBoth = currentPosition("170.00", INSTALLMENTS, "2024-04-01");
    assert.equal(afterBoth.overdueAmount, "170.00");

    const paid = INSTALLMENTS.map((installment) => ({
      ...installment,
      amountPaid: installment.totalDue,
    }));
    const closed = currentPosition("170.00", paid, "2024-04-01");
    assert.equal(closed.outstandingPrincipal, "0.00");
    assert.equal(closed.nextDueDate, null);
    assert.equal(closed.nextDueAmount, null);
    assert.equal(closed.overdueAmount, "0.00");
  });
});
