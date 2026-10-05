import { getPool } from "../../../lib/db.js";
import { handle, readJson } from "../../../lib/http/handle.js";
import { createLoan } from "../../../lib/loan/loans.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  return handle(request, async () => {
    const body = await readJson(request);
    const loan = await createLoan(getPool(), body);
    return { status: 201, body: loan };
  });
}
