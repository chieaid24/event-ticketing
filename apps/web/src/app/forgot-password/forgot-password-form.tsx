"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { AuthApiError, forgotPassword } from "../../lib/auth-api";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "accepted" }
  | { kind: "error"; message: string };

export function ForgotPasswordForm({
  apiBaseUrl,
}: Readonly<{ apiBaseUrl: string }>): ReactNode {
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");

    setState({ kind: "submitting" });
    try {
      await forgotPassword(apiBaseUrl, email);
      setState({ kind: "accepted" });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "The request failed. Try again.",
      });
    }
  }

  if (state.kind === "accepted") {
    return (
      <p aria-live="polite" className="form-status form-status--success">
        If an account exists for that address, a reset link is on its way. It
        expires after 30 minutes.
      </p>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="forgot-email">Email address</label>
        <input
          autoComplete="email"
          id="forgot-email"
          name="email"
          required
          type="email"
        />
      </div>
      <button
        className="button-primary"
        disabled={state.kind === "submitting"}
        type="submit"
      >
        {state.kind === "submitting" ? "Sending link..." : "Send reset link"}
      </button>
      <p aria-live="polite" className="form-status form-status--error">
        {state.kind === "error" ? `Error: ${state.message}` : ""}
      </p>
    </form>
  );
}
