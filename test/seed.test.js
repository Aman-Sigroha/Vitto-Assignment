import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSeedLoans } from "../db/seed-data.js";
import { compareMoney } from "../lib/money.js";
import { buildRepaymentSchedule } from "../lib/loan/schedule.js";
import { currentPosition } from "../lib/loan/position.js";

describe("seed loan plan", () => {
  it("returns the same three loans for the same day", () => {
    const today = "2026-10-06";
    const first = resolveSeedLoans(today);
    const second = resolveSeedLoans(today);
    assert.deepEqual(first.map((loan) => loan.key), ["current", "overdue", "partial"]);
    assert.deepEqual(second, first);
    assert.equal(first.find((loan) => loan.dashboard).key, "overdue");
  });

  it("keeps the current loan due today or later and the overdue loan past due", () => {
    for (const today of ["2026-10-06", "2030-01-15"]) {
      const loans = resolveSeedLoans(today);
      const current = loans.find((loan) => loan.key === "current");
      const overdue = loans.find((loan) => loan.key === "overdue");
      const currentSchedule = buildRepaymentSchedule(current);
      const overdueSchedule = buildRepaymentSchedule(overdue);

      assert.equal(current.disbursementDate, `${today.slice(0, 8)}01`);
      assert.ok(currentSchedule[0].dueDate >= today);
      assert.equal(currentPosition(current.principal, currentSchedule, today).overdueAmount, "0.00");
      assert.ok(overdueSchedule[0].dueDate < today);
      assert.ok(compareMoney(
        currentPosition(overdue.principal, overdueSchedule, today).overdueAmount,
        "0.00",
      ) > 0);
    }
  });

  it("plans one partial payment under the first installment total", () => {
    const partial = resolveSeedLoans("2026-10-06").find((loan) => loan.key === "partial");
    const schedule = buildRepaymentSchedule(partial);
    assert.equal(partial.payment.idempotencyKey, "seed-partial-installment-v1");
    assert.equal(partial.payment.amount, "5000.00");
    assert.ok(schedule[0].dueDate <= partial.payment.paymentDate);
    assert.ok(compareMoney(partial.payment.amount, schedule[0].totalDue) < 0);
  });
});
