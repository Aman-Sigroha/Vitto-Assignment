import { getPool } from "../../../../../lib/db.js";
import { handle, readJson } from "../../../../../lib/http/handle.js";
import { recordPayment } from "../../../../../lib/loan/payment.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  return handle(request, async () => {
    const { id } = await context.params;
    const body = await readJson(request);
    const payment = await recordPayment(getPool(), {
      loanId: id,
      amount: body.amount,
      paymentDate: body.paymentDate,
      idempotencyKey: body.idempotencyKey,
    });
    return {
      status: payment.duplicate ? 200 : 201,
      body: { payment: toPaymentResponse(payment) },
    };
  });
}

function toPaymentResponse(payment) {
  return {
    id: payment.paymentId,
    loanId: payment.loanId,
    amount: payment.amount,
    paymentDate: payment.paymentDate,
    idempotencyKey: payment.idempotencyKey,
    duplicate: payment.duplicate,
    allocations: payment.allocations,
    installments: payment.installments,
  };
}
