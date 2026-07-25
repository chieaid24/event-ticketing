"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { AuthApiError, resetPassword } from "../../lib/auth-api";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "reset" }
  | { kind: "error"; message: string };

export function ResetPasswordForm({
  apiBaseUrl,
  token,
}: Readonly<{ apiBaseUrl: string; token: string }>): ReactNode {
  const [state, setState] = useState<FormState>(
    token
      ? { kind: "idle" }
      : { kind: "error", message: "The reset link is incomplete." }
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    setState({ kind: "submitting" });
    try {
      await resetPassword(apiBaseUrl, { password, token });
      setState({ kind: "reset" });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "The reset failed. Try again.",
      });
    }
  }

  if (state.kind === "reset") {
    return (
      <>
        <p aria-live="polite" className="form-status form-status--success">
          Your password is updated and every session is signed out.
        </p>
        <p className="auth-alt">
          <a href="/login">Sign in with the new password</a>
        </p>
      </>
    );
  }

  if (!token) {
    return (
      <>
        <p aria-live="polite" className="form-status form-status--error">
          Error: The reset link is incomplete.
        </p>
        <p className="auth-alt">
          <a href="/forgot-password">Request a new link</a>
        </p>
      </>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="reset-password">New password</label>
        <input
          autoComplete="new-password"
          id="reset-password"
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
        {state.kind === "submitting" ? "Saving password..." : "Save password"}
      </button>
      <p aria-live="polite" className="form-status form-status--error">
        {state.kind === "error" ? `Error: ${state.message}` : ""}
      </p>
    </form>
  );
}
