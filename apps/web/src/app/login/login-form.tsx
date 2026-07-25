"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { AuthApiError, login } from "../../lib/auth-api";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

export function LoginForm({
  apiBaseUrl,
}: Readonly<{ apiBaseUrl: string }>): ReactNode {
  const router = useRouter();
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setState({ kind: "submitting" });
    try {
      await login(apiBaseUrl, { email, password });
      router.push("/account");
      router.refresh();
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "Sign in failed. Try again.",
      });
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="login-email">Email address</label>
        <input
          autoComplete="email"
          id="login-email"
          name="email"
          required
          type="email"
        />
      </div>
      <div className="form-field">
        <label htmlFor="login-password">Password</label>
        <input
          autoComplete="current-password"
          id="login-password"
          name="password"
          required
          type="password"
        />
      </div>
      <button
        className="button-primary"
        disabled={state.kind === "submitting"}
        type="submit"
      >
        {state.kind === "submitting" ? "Signing in..." : "Sign in"}
      </button>
      <p aria-live="polite" className="form-status form-status--error">
        {state.kind === "error" ? `Error: ${state.message}` : ""}
      </p>
    </form>
  );
}
