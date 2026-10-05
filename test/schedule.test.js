import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addMoney, compareMoney, subtractMoney } from "../lib/money.js";
import { buildRepaymentSchedule } from "../lib/loan/schedule.js";

const EXAMPLE = {
  principal: "200000.00",
  annualInterestRate: "18",
  tenureMonths: 24,
  disbursementDate: "2024-01-15",
};

function sumColumn(schedule, column) {
  return schedule.reduce((total, installment) => addMoney(total, installment[column]), "0.00");
}

describe("repayment schedule", () => {
  it("produces an EMI within ₹2 of ₹9,986 for ₹2,00,000 at 18% over 24 months", () => {
    const schedule = buildRepaymentSchedule(EXAMPLE);
    assert.equal(schedule.length, 24);
    assert.equal(schedule[0].totalDue, "9984.82");
    assert.equal(compareMoney(subtractMoney("9986.00", schedule[0].totalDue), "2.00") <= 0, true);
    assert.equal(schedule[0].interestDue, "3000.00");
    assert.equal(schedule[0].principalDue, "6984.82");
    assert.equal(schedule[0].amountPaid, "0.00");
    assert.equal(schedule[0].dueDate, "2024-02-15");
  });

  it("reconciles principal components to the original principal", () => {
    const schedule = buildRepaymentSchedule(EXAMPLE);
    assert.equal(sumColumn(schedule, "principalDue"), "200000.00");
  });

  it("reconciles every installment total to principal plus interest", () => {
    const schedule = buildRepaymentSchedule(EXAMPLE);
    for (const installment of schedule) {
      assert.equal(
        addMoney(installment.principalDue, installment.interestDue),
        installment.totalDue,
      );
    }
    assert.equal(
      sumColumn(schedule, "totalDue"),
      addMoney(sumColumn(schedule, "principalDue"), sumColumn(schedule, "interestDue")),
    );
  });

  it("puts the rounding remainder on the final installment", () => {
    const schedule = buildRepaymentSchedule(EXAMPLE);
    for (const installment of schedule.slice(0, 23)) {
      assert.equal(installment.totalDue, "9984.82");
    }
    assert.equal(schedule[23].totalDue, "9984.83");
    assert.equal(schedule[23].installmentNo, 24);

    const zeroInterest = buildRepaymentSchedule({
      principal: "100.00",
      annualInterestRate: "0",
      tenureMonths: 3,
      disbursementDate: "2024-01-15",
    });
    assert.deepEqual(zeroInterest.map((row) => row.principalDue), ["33.33", "33.33", "33.34"]);
    assert.deepEqual(zeroInterest.map((row) => row.interestDue), ["0.00", "0.00", "0.00"]);
    assert.equal(sumColumn(zeroInterest, "principalDue"), "100.00");
  });

  it("clamps end-of-month due dates instead of rolling into the next month", () => {
    const leapYear = buildRepaymentSchedule({
      principal: "300.00",
      annualInterestRate: "0",
      tenureMonths: 3,
      disbursementDate: "2024-01-31",
    });
    assert.deepEqual(leapYear.map((row) => row.dueDate), [
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
    ]);

    const nonLeap = buildRepaymentSchedule({
      principal: "100.00",
      annualInterestRate: "0",
      tenureMonths: 1,
      disbursementDate: "2023-01-31",
    });
    assert.equal(nonLeap[0].dueDate, "2023-02-28");
  });

  it("rejects a principal that is not a positive decimal amount", () => {
    const cases = ["0", "0.00", "-200000.00", "abc", "200000.001", 200000];
    for (const principal of cases) {
      assert.throws(
        () => buildRepaymentSchedule({ ...EXAMPLE, principal }),
        /Principal must be a positive amount/,
      );
    }
  });

  it("rejects zero, fractional, and non-numeric tenure", () => {
    for (const tenureMonths of [0, -1, 1.5, "24", Number.NaN]) {
      assert.throws(
        () => buildRepaymentSchedule({ ...EXAMPLE, tenureMonths }),
        /Tenure must be a whole number of months greater than zero/,
      );
    }
  });

  it("rejects invalid interest rates, dates, and other malformed input", () => {
    assert.throws(
      () => buildRepaymentSchedule({ ...EXAMPLE, annualInterestRate: "-1" }),
      /Annual interest rate/,
    );
    assert.throws(
      () => buildRepaymentSchedule({ ...EXAMPLE, annualInterestRate: "18.12345" }),
      /Annual interest rate/,
    );
    assert.throws(
      () => buildRepaymentSchedule({ ...EXAMPLE, annualInterestRate: 18 }),
      /Annual interest rate/,
    );
    assert.throws(
      () => buildRepaymentSchedule({ ...EXAMPLE, disbursementDate: "2023-02-29" }),
      /Disbursement date/,
    );
    assert.throws(
      () => buildRepaymentSchedule({ ...EXAMPLE, disbursementDate: "15-01-2024" }),
      /Disbursement date/,
    );
  });
});
