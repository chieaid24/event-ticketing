"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type { AuthUser, SessionSummary } from "@event-ticketing/contracts";

import {
  AuthApiError,
  changePassword,
  logout,
  revokeSession,
} from "../../lib/auth-api";

// fixed locale+zone so server/client render match
const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatTimestamp(iso: string): string {
  return `${timestampFormat.format(new Date(iso))} UTC`;
}

type ActionState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function AccountPanels({
  apiBaseUrl,
  sessions,
  user,
}: Readonly<{
  apiBaseUrl: string;
  sessions: readonly SessionSummary[];
  user: AuthUser;
}>): ReactNode {
  const router = useRouter();
  const [passwordState, setPasswordState] = useState<ActionState>({
    kind: "idle",
  });
  const [sessionState, setSessionState] = useState<ActionState>({
    kind: "idle",
  });

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");

    setPasswordState({ kind: "busy" });
    try {
      await changePassword(apiBaseUrl, { currentPassword, newPassword });
      formElement.reset();
      setPasswordState({
        kind: "success",
        message:
          "Password changed. Every other device is signed out; this one stays signed in.",
      });
      router.refresh();
    } catch (error) {
      setPasswordState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "The change failed. Try again.",
      });
    }
  }

  async function handleRevoke(session: SessionSummary) {
    setSessionState({ kind: "busy" });
    try {
      await revokeSession(apiBaseUrl, session.id);
      if (session.current) {
        router.push("/login");
        router.refresh();
        return;
      }
      setSessionState({ kind: "success", message: "Session revoked." });
      router.refresh();
    } catch (error) {
      setSessionState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "The revocation failed. Try again.",
      });
    }
  }

  async function handleLogout() {
    setSessionState({ kind: "busy" });
    try {
      await logout(apiBaseUrl);
      router.push("/");
      router.refresh();
    } catch (error) {
      setSessionState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "Signing out failed. Try again.",
      });
    }
  }

  return (
    <>
      <section aria-labelledby="details-heading" className="account-section">
        <h2 id="details-heading">Details</h2>
        <dl className="account-details">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd>
              {user.emailVerifiedAt
                ? formatTimestamp(user.emailVerifiedAt)
                : "Not verified"}
            </dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.platformRole}</dd>
          </div>
        </dl>
        <p className="form-status">
          <button
            className="button-quiet"
            disabled={sessionState.kind === "busy"}
            onClick={() => void handleLogout()}
            type="button"
          >
            Sign out
          </button>
        </p>
      </section>

      <section aria-labelledby="password-heading" className="account-section">
        <h2 id="password-heading">Change password</h2>
        <p>Changing it signs out every other device.</p>
        <form className="auth-form" onSubmit={handleChangePassword}>
          <div className="form-field">
            <label htmlFor="current-password">Current password</label>
            <input
              autoComplete="current-password"
              id="current-password"
              name="currentPassword"
              required
              type="password"
            />
          </div>
          <div className="form-field">
            <label htmlFor="new-password">New password</label>
            <input
              autoComplete="new-password"
              id="new-password"
              minLength={12}
              name="newPassword"
              required
              type="password"
            />
            <p className="field-hint">Use at least 12 characters.</p>
          </div>
          <button
            className="button-primary"
            disabled={passwordState.kind === "busy"}
            type="submit"
          >
            {passwordState.kind === "busy"
              ? "Changing password..."
              : "Change password"}
          </button>
          <p
            aria-live="polite"
            className={`form-status ${
              passwordState.kind === "error"
                ? "form-status--error"
                : "form-status--success"
            }`}
          >
            {passwordState.kind === "error"
              ? `Error: ${passwordState.message}`
              : passwordState.kind === "success"
                ? passwordState.message
                : ""}
          </p>
        </form>
      </section>

      <section aria-labelledby="sessions-heading" className="account-section">
        <h2 id="sessions-heading">Active sessions</h2>
        <p>
          Each entry is a device or browser where your account is signed in.
        </p>
        {sessions.length === 0 ? (
          <p className="form-status">No active sessions found.</p>
        ) : (
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <p className="session-list__device">
                    {session.deviceSummary}
                    {session.current ? (
                      <span className="session-list__current">This device</span>
                    ) : null}
                  </p>
                  <p className="session-list__meta">
                    Signed in {formatTimestamp(session.createdAt)}, last seen{" "}
                    {formatTimestamp(session.lastSeenAt)}
                  </p>
                </div>
                <button
                  className="button-quiet button-quiet--danger"
                  disabled={sessionState.kind === "busy"}
                  onClick={() => void handleRevoke(session)}
                  type="button"
                >
                  {session.current ? "Sign out" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p
          aria-live="polite"
          className={`form-status ${
            sessionState.kind === "error"
              ? "form-status--error"
              : "form-status--success"
          }`}
        >
          {sessionState.kind === "error"
            ? `Error: ${sessionState.message}`
            : sessionState.kind === "success"
              ? sessionState.message
              : ""}
        </p>
      </section>
    </>
  );
}
