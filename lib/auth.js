import { getAdminAuth } from "./firebase-admin.js";
import { HttpError } from "./http/errors.js";

const UNAUTHENTICATED_MESSAGE = "A valid Firebase ID token is required.";

export async function requireRequestUser(request) {
  const token = readBearerToken(request);
  if (!token) {
    throw unauthenticated();
  }

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(token, true);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.message === "FIREBASE_ADMIN_NOT_CONFIGURED") {
      console.error("Firebase Admin credentials are not configured.");
      throw new HttpError(500, "INTERNAL_ERROR", "Unexpected server error.");
    }
    if (typeof error?.code === "string" && error.code.startsWith("auth/")) {
      throw unauthenticated();
    }
    console.error("Firebase token verification failed");
    throw new HttpError(500, "INTERNAL_ERROR", "Unexpected server error.");
  }

  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
  };
}

export function readBearerToken(request) {
  const header = request.headers.get("authorization");
  if (header == null || header.trim() === "") return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1];
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  return token;
}

function unauthenticated() {
  return new HttpError(401, "UNAUTHENTICATED", UNAUTHENTICATED_MESSAGE);
}
