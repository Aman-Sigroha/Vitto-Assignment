import { requireRequestUser } from "../auth.js";
import { HttpError, toClientError } from "./errors.js";

export async function handle(request, action) {
  try {
    await requireRequestUser(request);
    const result = await action();
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    const clientError = toClientError(error);
    if (clientError.status === 500) {
      console.error(error);
    }
    return Response.json(
      { error: { code: clientError.code, message: clientError.message } },
      { status: clientError.status },
    );
  }
}

export async function readJson(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Request body must be JSON.");
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Request body must be a JSON object.");
  }

  return body;
}
