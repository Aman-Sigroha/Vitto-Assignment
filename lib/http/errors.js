export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function toClientError(error) {
  if (error instanceof HttpError) {
    return { status: error.status, code: error.code, message: error.message };
  }

  const message = typeof error?.message === "string" ? error.message : "";
  if (message === "Loan not found.") {
    return { status: 404, code: "LOAN_NOT_FOUND", message };
  }
  if (message.startsWith("Payment exceeds the remaining amount")) {
    return { status: 422, code: "PAYMENT_EXCEEDS_BALANCE", message };
  }
  if (message === "Loan has no installments.") {
    return { status: 422, code: "UNPROCESSABLE", message };
  }
  if (isValidationMessage(message)) {
    return { status: 400, code: "VALIDATION_ERROR", message };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Unexpected server error.",
  };
}

function isValidationMessage(message) {
  return message.startsWith("Principal must")
    || message.startsWith("Annual interest rate")
    || message.startsWith("Tenure must")
    || message.startsWith("Disbursement date")
    || message.startsWith("Payment amount")
    || message.startsWith("Payment date")
    || message.startsWith("Idempotency key")
    || message.startsWith("Loan id")
    || message.startsWith("Request body");
}
