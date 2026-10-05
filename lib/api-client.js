"use client";

import { getFirebaseAuth } from "./firebase-client";

export async function authorizedFetch(url, options = {}) {
  const currentUser = getFirebaseAuth().currentUser;
  if (!currentUser) {
    throw new Error("Sign in is required.");
  }

  const token = await currentUser.getIdToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
