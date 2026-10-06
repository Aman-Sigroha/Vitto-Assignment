import { fileURLToPath } from "node:url";
import { applySchema } from "./apply-schema.js";
import { resolveSeedLoans } from "./seed-data.js";
import { closePool, getPool } from "../lib/db.js";
import { createLoan, getLoan } from "../lib/loan/loans.js";
import { recordPayment } from "../lib/loan/payment.js";
import { serverDate } from "../lib/loan/position.js";
import { compareMoney } from "../lib/money.js";
import { normalizeAnnualInterestRate } from "../lib/loan/schedule.js";

const SEED_LOCK = "742017";

export async function seedDatabase(pool, today = serverDate()) {
  await applySchema(pool);
  const client = await pool.connect();
  try {
    // Transaction lock, not a session lock. Neon’s pooler may serve the next
    // statement from a different backend, which would leave a session lock held.
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [SEED_LOCK]);
    const seeded = [];
    for (const plan of resolveSeedLoans(today)) {
      seeded.push(await ensureSeedLoan(pool, plan, today));
    }
    await client.query("COMMIT");
    return seeded;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already unusable. release() still returns it to the pool.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSeedLoan(pool, plan, today) {
  const existingId = await findSeedLoan(pool, plan, today);
  const loanId = existingId ?? (await createLoan(pool, plan, today)).loan.id;
  const payment = plan.payment
    ? await recordPayment(pool, { loanId, ...plan.payment })
    : null;
  const loaded = await getLoan(pool, loanId, today);

  if (plan.key === "overdue" && compareMoney(loaded.position.overdueAmount, "0.00") <= 0) {
    throw new Error("Overdue seed loan does not have a positive overdue amount.");
  }
  if (plan.key === "current" && loaded.position.overdueAmount !== "0.00") {
    throw new Error("Current seed loan has an overdue balance.");
  }

  return {
    key: plan.key,
    label: plan.label,
    id: String(loanId),
    created: existingId == null,
    duplicatePayment: payment?.duplicate === true,
    disbursementDate: loaded.loan.disbursementDate,
    overdueAmount: loaded.position.overdueAmount,
    dashboard: plan.dashboard,
  };
}

async function findSeedLoan(pool, plan, today) {
  if (plan.key === "current") {
    const open = await pool.query(
      `SELECT l.id
       FROM loans l
       JOIN installments i ON i.loan_id = l.id AND i.installment_no = 1
       WHERE l.principal = $1::numeric
         AND l.annual_interest_rate = $2::numeric
         AND l.tenure_months = $3
         AND i.due_date >= $4::date
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.loan_id = l.id)
       ORDER BY l.id
       LIMIT 1`,
      [plan.principal, normalizeAnnualInterestRate(plan.annualInterestRate), plan.tenureMonths, today],
    );
    return open.rows[0] ? String(open.rows[0].id) : null;
  }

  const exact = await pool.query(
    `SELECT id
     FROM loans
     WHERE principal = $1::numeric
       AND annual_interest_rate = $2::numeric
       AND tenure_months = $3
       AND disbursement_date = $4::date
     ORDER BY id
     LIMIT 1`,
    [
      plan.principal,
      normalizeAnnualInterestRate(plan.annualInterestRate),
      plan.tenureMonths,
      plan.disbursementDate,
    ],
  );
  return exact.rows[0] ? String(exact.rows[0].id) : null;
}

function report(seeded) {
  console.log("Seeded loans:");
  for (const loan of seeded) {
    const action = loan.created ? "created" : "reused";
    console.log(
      `- ${loan.label}: id=${loan.id} (${action}), disbursed ${loan.disbursementDate}, overdue ${loan.overdueAmount}`,
    );
  }
  const dashboard = seeded.find((loan) => loan.dashboard);
  console.log(`Set NEXT_PUBLIC_SEEDED_LOAN_ID=${dashboard.id}`);
  console.log("Use that overdue loan id for the dashboard.");
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  seedDatabase(getPool())
    .then((seeded) => {
      report(seeded);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
