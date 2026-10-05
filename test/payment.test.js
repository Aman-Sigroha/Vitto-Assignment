import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRepaymentSchedule } from "../lib/loan/schedule.js";
import { allocatePayment, resultForExistingPayment } from "../lib/loan/payment.js";
import { addMoney, subtractMoney } from "../lib/money.js";

function exampleSchedule() {
  return buildRepaymentSchedule({
    principal: "200000.00",
    annualInterestRate: "18",
    tenureMonths: 24,
    disbursementDate: "2024-01-15",
  });
}

function paidInFull(installment) {
  return { ...installment, amountPaid: installment.totalDue };
}

describe("payment allocation", () => {
  it("applies a ₹5,000 underpayment to the oldest installment and leaves it partial", () => {
    const schedule = exampleSchedule();
    const result = allocatePayment(schedule, "5000.00");

    assert.equal(result.unallocatedAmount, "0.00");
    assert.equal(result.allocations.length, 1);
    assert.equal(result.allocations[0].installmentNo, 1);
    assert.equal(result.allocations[0].amountAllocated, "5000.00");
    assert.equal(result.allocations[0].amountPaid, "5000.00");
    assert.equal(result.installments[0].amountPaid, "5000.00");
    assert.equal(result.installments[1].amountPaid, "0.00");
    assert.equal(subtractMoney(schedule[0].totalDue, "5000.00"), "4984.82");
    assert.equal(schedule[0].amountPaid, "0.00");
  });

  it("settles an installment exactly and stops before the next one", () => {
    const schedule = exampleSchedule();
    const result = allocatePayment(schedule, schedule[0].totalDue);

    assert.equal(schedule[0].totalDue, "9984.82");
    assert.equal(result.installments[0].amountPaid, "9984.82");
    assert.equal(result.installments[1].amountPaid, "0.00");
    assert.equal(result.allocations.length, 1);
    assert.equal(result.unallocatedAmount, "0.00");
  });

  it("fills the oldest installment and partially pays the next one", () => {
    const schedule = exampleSchedule();
    const result = allocatePayment(schedule, addMoney(schedule[0].totalDue, "5000.00"));

    assert.equal(result.installments[0].amountPaid, schedule[0].totalDue);
    assert.equal(result.installments[1].amountPaid, "5000.00");
    assert.equal(result.installments[2].amountPaid, "0.00");
    assert.equal(result.allocations[1].interestAllocated, schedule[1].interestDue);
    assert.equal(
      result.allocations[1].principalAllocated,
      subtractMoney("5000.00", schedule[1].interestDue),
    );
  });

  it("settles two normal installments for twice the EMI, using the real final installment when that is what remains", () => {
    const schedule = exampleSchedule();
    const twoEmis = addMoney(schedule[0].totalDue, schedule[1].totalDue);
    const firstTwo = allocatePayment(schedule, twoEmis);

    assert.equal(twoEmis, "19969.64");
    assert.equal(firstTwo.installments[0].amountPaid, "9984.82");
    assert.equal(firstTwo.installments[1].amountPaid, "9984.82");
    assert.equal(firstTwo.installments[2].amountPaid, "0.00");
    assert.equal(firstTwo.allocations.length, 2);

    const tail = schedule.map((installment, index) => (
      index < 22 ? paidInFull(installment) : installment
    ));
    const almostTwo = allocatePayment(tail, twoEmis);
    assert.equal(almostTwo.unallocatedAmount, "0.00");
    assert.equal(almostTwo.installments[22].amountPaid, schedule[22].totalDue);
    assert.equal(almostTwo.installments[23].amountPaid, "9984.82");
    assert.equal(subtractMoney(schedule[23].totalDue, almostTwo.installments[23].amountPaid), "0.01");
  });

  it("continues a second partial payment from the unpaid balance", () => {
    const schedule = exampleSchedule();
    const first = allocatePayment(schedule, "5000.00");
    const second = allocatePayment(first.installments, "2000.00");

    assert.equal(second.allocations.length, 1);
    assert.equal(second.allocations[0].interestAllocated, "0.00");
    assert.equal(second.allocations[0].principalAllocated, "2000.00");
    assert.equal(second.installments[0].amountPaid, "7000.00");
    assert.equal(second.installments[1].amountPaid, "0.00");
  });

  it("covers outstanding interest before outstanding principal", () => {
    const schedule = exampleSchedule();
    const interestOnly = allocatePayment(schedule, "1000.00");

    assert.equal(interestOnly.allocations[0].interestAllocated, "1000.00");
    assert.equal(interestOnly.allocations[0].principalAllocated, "0.00");

    const interestAndPrincipal = allocatePayment(schedule, "5000.00");
    assert.equal(interestAndPrincipal.allocations[0].interestAllocated, "3000.00");
    assert.equal(interestAndPrincipal.allocations[0].principalAllocated, "2000.00");
  });

  it("rejects a payment larger than the loan's remaining due", () => {
    const schedule = exampleSchedule();
    const remaining = schedule.reduce((total, installment) => addMoney(total, installment.totalDue), "0.00");

    assert.throws(
      () => allocatePayment(schedule, addMoney(remaining, "0.01")),
      /Payment exceeds the remaining amount due on the loan/,
    );

    const closed = schedule.map(paidInFull);
    assert.throws(
      () => allocatePayment(closed, "0.01"),
      /Payment exceeds the remaining amount due on the loan/,
    );
  });

  it("rejects negative, zero, non-numeric, and over-precise payment amounts", () => {
    const schedule = exampleSchedule();
    for (const amount of ["0", "0.00", "-5.00", "abc", "10.001", 5000]) {
      assert.throws(
        () => allocatePayment(schedule, amount),
        /Payment amount must be a positive amount/,
      );
    }
  });

  it("returns the stored payment for a repeated idempotency key without allocating again", () => {
    const stored = {
      paymentId: "9",
      loanId: "4",
      amount: "5000.00",
      paymentDate: "2024-08-01",
      idempotencyKey: "rent-august",
      allocations: [
        {
          installmentNo: 1,
          interestAllocated: "3000.00",
          principalAllocated: "2000.00",
          amountAllocated: "5000.00",
          amountPaid: "5000.00",
        },
      ],
    };

    const replay = resultForExistingPayment(stored);

    assert.equal(replay.duplicate, true);
    assert.equal(replay.paymentId, "9");
    assert.equal(replay.amount, "5000.00");
    assert.equal(replay.paymentDate, "2024-08-01");
    assert.equal(replay.idempotencyKey, "rent-august");
    assert.deepEqual(replay.allocations, stored.allocations);
    assert.deepEqual(replay.installments, [{ installmentNo: 1, amountPaid: "5000.00" }]);
    replay.allocations[0].amountPaid = "1.00";
    assert.equal(stored.allocations[0].amountPaid, "5000.00");
  });
});
