import pg from "pg";

const { Pool } = pg;

// NUMERIC must stay a string. The default pg parser already does this; setting
// it here keeps money values off JavaScript floating point if defaults change.
const NUMERIC_OID = 1700;
pg.types.setTypeParser(NUMERIC_OID, (value) => value);

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
