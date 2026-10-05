import { closePool, getPool } from "../lib/db.js";
import { applySchema } from "./apply-schema.js";

// UI seed loans are added in a later stage. Each entry will be:
// { principal, annualInterestRate, tenureMonths, disbursementDate }
const SEED_LOANS = [];

async function seed() {
  const pool = getPool();
  try {
    await applySchema(pool);
    if (SEED_LOANS.length === 0) {
      console.log("Database schema is ready. No loans were seeded.");
      return;
    }
  } finally {
    await closePool();
  }
}

seed().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
