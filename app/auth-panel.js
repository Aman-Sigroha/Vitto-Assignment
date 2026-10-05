"use client";

import { useState } from "react";
import { useAuth } from "./auth-provider";

export function AuthPanel() {
  const { user, loading, configError, signIn, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <p>Checking sign-in status.</p>;
  }

  if (configError) {
    return <p>{configError}</p>;
  }

  if (user) {
    return (
      <section>
        <p>Signed in as {user.email || user.uid}.</p>
        <button type="button" onClick={() => signOut()}>Sign out</button>
      </section>
    );
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await signIn(email, password);
    } catch {
      setError("Sign-in failed. Check the email and password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h2>Sign in</h2>
      <label>
        Email
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {error ? <p>{error}</p> : null}
      <button type="submit" disabled={submitting}>Sign in</button>
    </form>
  );
}
