"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { firebaseClientConfigError, getFirebaseAuth } from "../lib/firebase-client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [configError] = useState(firebaseClientConfigError);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!configError);

  useEffect(() => {
    if (configError) return undefined;
    return onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser
        ? { uid: nextUser.uid, email: nextUser.email ?? null }
        : null);
      setLoading(false);
    });
  }, [configError]);

  const value = useMemo(() => ({
    user,
    loading,
    configError,
    async signIn(email, password) {
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      return { uid: credential.user.uid, email: credential.user.email ?? null };
    },
    async signOut() {
      await signOut(getFirebaseAuth());
    },
  }), [user, loading, configError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
