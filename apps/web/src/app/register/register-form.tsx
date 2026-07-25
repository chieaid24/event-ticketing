"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { AuthApiError, registerAccount } from "../../lib/auth-api";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "accepted"; email: string }
  | { kind: "error"; message: string };

export function RegisterForm({
  apiBaseUrl,
}: Readonly<{ apiBaseUrl: string }>): ReactNode {
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setState({ kind: "submitting" });
    try {
      await registerAccount(apiBaseUrl, { email, password });
      setState({ email, kind: "accepted" });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "Registration failed. Try again.",
      });
    }
  }

  if (state.kind === "accepted") {
    return (
      <p aria-live="polite" className="form-status form-status--success">
        Check your inbox. If {state.email} is available, a verification link is
        on its way and stays valid for one day.
      </p>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="register-email">Email address</label>
        <input
          autoComplete="email"
          id="register-email"
          name="email"
          required
          type="email"
        />
      </div>
      <div className="form-field">
        <label htmlFor="register-password">Password</label>
        <input
          autoComplete="new-password"
          id="register-password"
          minLength={12}
          name="password"
          required
          type="password"
        />
        <p className="field-hint">Use at least 12 characters.</p>
      </div>
      <button
        className="button-primary"
        disabled={state.kind === "submitting"}
        type="submit"
      >
        {state.kind === "submitting" ? "Creating account..." : "Create account"}
      </button>
      <p aria-live="polite" className="form-status form-status--error">
        {state.kind === "error" ? `Error: ${state.message}` : ""}
      </p>
    </form>
  );
}
