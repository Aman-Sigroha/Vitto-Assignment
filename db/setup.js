import { closePool, getPool } from "../lib/db.js";
import { applySchema } from "./apply-schema.js";

async function setup() {
  const pool = getPool();
  try {
    await applySchema(pool);
    console.log("Database schema is ready.");
  } finally {
    await closePool();
  }
}

setup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
