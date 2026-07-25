"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { AuthApiError, verifyEmail } from "../../lib/auth-api";

type VerifyState =
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "error"; message: string };

export function VerifyEmailClient({
  apiBaseUrl,
  token,
}: Readonly<{ apiBaseUrl: string; token: string }>): ReactNode {
  const started = useRef(false);
  const [state, setState] = useState<VerifyState>(
    token
      ? { kind: "verifying" }
      : { kind: "error", message: "The verification link is incomplete." }
  );

  useEffect(() => {
    if (!token || started.current) {
      return;
    }
    started.current = true;

    verifyEmail(apiBaseUrl, token)
      .then(() => {
        setState({ kind: "verified" });
      })
      .catch((error: unknown) => {
        setState({
          kind: "error",
          message:
            error instanceof AuthApiError
              ? error.message
              : "Verification failed. Try again.",
        });
      });
  }, [apiBaseUrl, token]);

  if (state.kind === "verifying") {
    return (
      <p aria-live="polite" className="form-status">
        Confirming your email address...
      </p>
    );
  }

  if (state.kind === "verified") {
    return (
      <>
        <p aria-live="polite" className="form-status form-status--success">
          Your email address is verified and your account is active.
        </p>
        <p className="auth-alt">
          <a href="/login">Sign in to continue</a>
        </p>
      </>
    );
  }

  return (
    <>
      <p aria-live="polite" className="form-status form-status--error">
        Error: {state.message}
      </p>
      <p className="auth-alt">
        Need a new link? <a href="/register">Register again</a> with the same
        email address.
      </p>
    </>
  );
}
