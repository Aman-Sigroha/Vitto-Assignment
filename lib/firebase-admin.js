import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let adminAuth;

export function normalizePrivateKey(value) {
  if (typeof value !== "string") return "";
  let key = value.trim();
  if (key.startsWith("\"") && key.endsWith("\"")) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

export function getAdminAuth() {
  if (adminAuth) return adminAuth;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FIREBASE_ADMIN_NOT_CONFIGURED");
  }

  try {
    const app = getApps()[0] ?? initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    adminAuth = getAuth(app);
  } catch {
    throw new Error("FIREBASE_ADMIN_NOT_CONFIGURED");
  }

  return adminAuth;
}
