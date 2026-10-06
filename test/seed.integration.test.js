import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { seedDatabase } from "../db/seed.js";
import { closePool, getPool } from "../lib/db.js";
import { getLoan } from "../lib/loan/loans.js";
import { addMoney, compareMoney } from "../lib/money.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for seed integration tests. These tests do not mock PostgreSQL.");
}

describe("seeded loans", () => {
  after(async () => {
    await closePool();
  });

  it("persists valid schedules, an overdue loan, and one partial payment, then reuses them", async () => {
    const pool = getPool();
    const first = await seedDatabase(pool);
    const second = await seedDatabase(pool);

    assert.deepEqual(second.map((loan) => loan.id), first.map((loan) => loan.id));
    assert.equal(second.every((loan) => loan.created === false), true);
    assert.equal(second.find((loan) => loan.key === "partial").duplicatePayment, true);

    for (const seeded of second) {
      const loaded = await getLoan(pool, seeded.id);
      assert.equal(loaded.installments.length, loaded.loan.tenureMonths);
      let principalSum = "0.00";
      for (const installment of loaded.installments) {
        principalSum = addMoney(principalSum, installment.principalDue);
        assert.equal(addMoney(installment.principalDue, installment.interestDue), installment.totalDue);
      }
      assert.equal(principalSum, loaded.loan.principal);
    }

    const overdue = await getLoan(pool, second.find((loan) => loan.key === "overdue").id);
    assert.ok(compareMoney(overdue.position.overdueAmount, "0.00") > 0);
    assert.equal(overdue.installments.every((installment) => installment.amountPaid === "0.00"), true);

    const partialId = second.find((loan) => loan.key === "partial").id;
    const partial = await getLoan(pool, partialId);
    const payment = await pool.query(
      `SELECT p.id, p.amount
       FROM payments p
       WHERE p.loan_id = $1 AND p.idempotency_key = $2`,
      [partialId, "seed-partial-installment-v1"],
    );
    assert.equal(payment.rowCount, 1);
    assert.equal(payment.rows[0].amount, "5000.00");

    const allocations = await pool.query(
      `SELECT a.interest_allocated, a.principal_allocated, a.amount_paid_after,
              i.installment_no, i.amount_paid, i.total_due
       FROM payment_allocations a
       JOIN installments i ON i.id = a.installment_id
       WHERE a.payment_id = $1
       ORDER BY i.installment_no`,
      [payment.rows[0].id],
    );
    assert.ok(allocations.rowCount >= 1);
    let allocated = "0.00";
    for (const row of allocations.rows) {
      const applied = addMoney(row.interest_allocated, row.principal_allocated);
      allocated = addMoney(allocated, applied);
      assert.equal(row.amount_paid_after, row.amount_paid);
      assert.ok(compareMoney(row.amount_paid, row.total_due) < 0);
    }
    assert.equal(allocated, "5000.00");
    assert.equal(allocations.rows[0].installment_no, 1);
    assert.equal(partial.installments[0].amountPaid, "5000.00");
    assert.ok(compareMoney(partial.installments[0].amountPaid, partial.installments[0].totalDue) < 0);

    const overdueCount = await pool.query(
      `SELECT COUNT(*)::text AS count
       FROM loans
       WHERE principal = 180000.00
         AND annual_interest_rate = 18.0000
         AND tenure_months = 12
         AND disbursement_date = DATE '2024-03-15'`,
    );
    assert.equal(overdueCount.rows[0].count, "1");
  });
});
