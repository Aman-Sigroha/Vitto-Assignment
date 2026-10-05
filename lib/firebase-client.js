"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

export function firebaseClientConfigError() {
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    || !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    || !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    return "Firebase client configuration is missing.";
  }
  return "";
}

export function getFirebaseAuth() {
  const configError = firebaseClientConfigError();
  if (configError) throw new Error(configError);
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const app = getApps().length > 0
    ? getApp()
    : initializeApp({ apiKey, authDomain, projectId });
  return getAuth(app);
}
