"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type {
  InvitationSummary,
  OrganizationSummary,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../lib/auth-api";
import { createOrganization, respondToInvitation } from "../../lib/org-api";
import { roleLabels } from "../../lib/roles";

type ActionState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function statusLine(state: ActionState): ReactNode {
  return (
    <p
      aria-live="polite"
      className={`form-status ${
        state.kind === "error" ? "form-status--error" : "form-status--success"
      }`}
    >
      {state.kind === "error"
        ? `Error: ${state.message}`
        : state.kind === "success"
          ? state.message
          : ""}
    </p>
  );
}

export function OrganizationsPanels({
  apiBaseUrl,
  invitations,
  organizations,
}: Readonly<{
  apiBaseUrl: string;
  invitations: readonly InvitationSummary[];
  organizations: readonly OrganizationSummary[];
}>): ReactNode {
  const router = useRouter();
  const [inviteState, setInviteState] = useState<ActionState>({ kind: "idle" });
  const [createState, setCreateState] = useState<ActionState>({ kind: "idle" });

  async function handleInvitation(
    invitation: InvitationSummary,
    response: "accept" | "decline"
  ) {
    setInviteState({ kind: "busy" });
    try {
      await respondToInvitation(apiBaseUrl, invitation.membershipId, response);
      setInviteState({
        kind: "success",
        message:
          response === "accept"
            ? `You joined ${invitation.organization.name}.`
            : "Invitation declined.",
      });
      router.refresh();
    } catch (error) {
      setInviteState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "The request failed. Try again.",
      });
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const slug = String(form.get("slug") ?? "");

    setCreateState({ kind: "busy" });
    try {
      const created = await createOrganization(apiBaseUrl, { name, slug });
      router.push(`/organizations/${created.organization.id}`);
      router.refresh();
    } catch (error) {
      setCreateState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "Creating the organization failed. Try again.",
      });
    }
  }

  return (
    <>
      <section aria-labelledby="orgs-heading" className="account-section">
        <h2 id="orgs-heading">Your organizations</h2>
        {organizations.length === 0 ? (
          <p className="form-status">
            You are not a member of any organization yet.
          </p>
        ) : (
          <ul className="org-list">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <div>
                  <p className="org-list__name">
                    <a href={`/organizations/${organization.id}`}>
                      {organization.name}
                    </a>
                  </p>
                  <p className="org-list__meta">/{organization.slug}</p>
                </div>
                <span className="role-badge">
                  {roleLabels[organization.role]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {invitations.length > 0 ? (
        <section
          aria-labelledby="invitations-heading"
          className="account-section"
        >
          <h2 id="invitations-heading">Invitations</h2>
          <ul className="org-list">
            {invitations.map((invitation) => (
              <li key={invitation.membershipId}>
                <div>
                  <p className="org-list__name">
                    {invitation.organization.name}
                  </p>
                  <p className="org-list__meta">
                    {roleLabels[invitation.role]}
                    {invitation.invitedByEmail
                      ? `, invited by ${invitation.invitedByEmail}`
                      : ""}
                  </p>
                </div>
                <div className="org-list__actions">
                  <button
                    className="button-primary"
                    disabled={inviteState.kind === "busy"}
                    onClick={() => void handleInvitation(invitation, "accept")}
                    type="button"
                  >
                    Accept
                  </button>
                  <button
                    className="button-quiet"
                    disabled={inviteState.kind === "busy"}
                    onClick={() => void handleInvitation(invitation, "decline")}
                    type="button"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {statusLine(inviteState)}
        </section>
      ) : null}

      <section aria-labelledby="create-heading" className="account-section">
        <h2 id="create-heading">Create an organization</h2>
        <p>You become its owner and can invite the rest of the team.</p>
        <form className="auth-form" onSubmit={handleCreate}>
          <div className="form-field">
            <label htmlFor="org-name">Name</label>
            <input
              id="org-name"
              maxLength={160}
              minLength={3}
              name="name"
              required
              type="text"
            />
          </div>
          <div className="form-field">
            <label htmlFor="org-slug">URL name</label>
            <input
              id="org-slug"
              maxLength={80}
              minLength={3}
              name="slug"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
              type="text"
            />
            <p className="field-hint">
              Lowercase letters, numbers, and hyphens, like acme-tickets.
            </p>
          </div>
          <button
            className="button-primary"
            disabled={createState.kind === "busy"}
            type="submit"
          >
            {createState.kind === "busy"
              ? "Creating organization..."
              : "Create organization"}
          </button>
          {statusLine(createState)}
        </form>
      </section>
    </>
  );
}
