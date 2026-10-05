// Every loan and payment route calls this before doing work.
// Stage 5 replaces the body with Firebase ID token verification and throws
// HttpError(401, "UNAUTHENTICATED", ...) for a missing or invalid token.
// This build does not invent a user and does not accept a test header.

export async function requireRequestUser(_request) {}
