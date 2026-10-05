import { readFileSync } from "node:fs";

export async function applySchema(pool) {
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}
