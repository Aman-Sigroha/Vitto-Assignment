import { getPool } from "../../../../lib/db.js";
import { handle } from "../../../../lib/http/handle.js";
import { getLoan } from "../../../../lib/loan/loans.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, context) {
  return handle(request, async () => {
    const { id } = await context.params;
    const loan = await getLoan(getPool(), id);
    return { status: 200, body: loan };
  });
}
