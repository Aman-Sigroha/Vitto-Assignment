import pg from "pg";

const { Pool } = pg;

const NUMERIC_OID = 1700;
const DATE_OID = 1082;

// NUMERIC stays a string so money never becomes a JavaScript number.
// DATE stays a YYYY-MM-DD string so node-pg does not shift it through local midnight.
export function configurePgTypes() {
  pg.types.setTypeParser(NUMERIC_OID, (value) => value);
  pg.types.setTypeParser(DATE_OID, (value) => value);
}

configurePgTypes();

let pool;

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local or the environment.");
  }

  if (!pool) {
    pool = new Pool({ connectionString });
  }

  return pool;
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
