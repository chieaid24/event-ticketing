"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type {
  AuditLogEntry,
  Member,
  MembershipRole,
  OrganizationDetailResponse,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../../lib/auth-api";
import {
  changeMemberRole,
  deleteOrganization,
  inviteMember,
  removeMember,
  updateOrganizationSettings,
} from "../../../lib/org-api";
import { roleLabels } from "../../../lib/roles";

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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AuthApiError ? error.message : fallback;
}

export function OrganizationDetailPanels({
  apiBaseUrl,
  auditEntries,
  currentUserId,
  detail,
  members,
}: Readonly<{
  apiBaseUrl: string;
  auditEntries: readonly AuditLogEntry[] | null;
  currentUserId: string;
  detail: OrganizationDetailResponse;
  members: readonly Member[] | null;
}>): ReactNode {
  const router = useRouter();
  const { membership, organization } = detail;
  const permissions = membership.permissions;
  const [settingsState, setSettingsState] = useState<ActionState>({
    kind: "idle",
  });
  const [memberState, setMemberState] = useState<ActionState>({
    kind: "idle",
  });
  const [inviteState, setInviteState] = useState<ActionState>({
    kind: "idle",
  });
  const [deleteState, setDeleteState] = useState<ActionState>({
    kind: "idle",
  });
  const [confirmSlug, setConfirmSlug] = useState("");

  // Visibility mirrors the backend policy; the API is the enforcement point.
  const canManage = (target: Member): boolean =>
    target.userId !== currentUserId &&
    membership.assignableRoles.includes(target.role);

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    setSettingsState({ kind: "busy" });
    try {
      await updateOrganizationSettings(apiBaseUrl, organization.id, {
        name,
        version: organization.version,
      });
      setSettingsState({ kind: "success", message: "Name saved." });
      router.refresh();
    } catch (error) {
      setSettingsState({
        kind: "error",
        message: messageOf(error, "Saving failed. Try again."),
      });
      router.refresh();
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "");
    const role = String(form.get("role") ?? "") as MembershipRole;
    setInviteState({ kind: "busy" });
    try {
      await inviteMember(apiBaseUrl, organization.id, { email, role });
      formElement.reset();
      setInviteState({
        kind: "success",
        message: "Invitation recorded. The person sees it after signing in.",
      });
      router.refresh();
    } catch (error) {
      setInviteState({
        kind: "error",
        message: messageOf(error, "The invitation failed. Try again."),
      });
    }
  }

  async function handleRoleChange(target: Member, role: MembershipRole) {
    if (role === target.role) {
      return;
    }
    setMemberState({ kind: "busy" });
    try {
      await changeMemberRole(apiBaseUrl, organization.id, target.membershipId, {
        expectedRole: target.role,
        role,
      });
      setMemberState({
        kind: "success",
        message: `${target.email} is now ${roleLabels[role]}.`,
      });
      router.refresh();
    } catch (error) {
      setMemberState({
        kind: "error",
        message: messageOf(error, "The role change failed. Try again."),
      });
      router.refresh();
    }
  }

  async function handleRemove(target: Member) {
    const leaving = target.userId === currentUserId;
    setMemberState({ kind: "busy" });
    try {
      await removeMember(apiBaseUrl, organization.id, target.membershipId);
      if (leaving) {
        router.push("/organizations");
        router.refresh();
        return;
      }
      setMemberState({
        kind: "success",
        message: `${target.email} was removed.`,
      });
      router.refresh();
    } catch (error) {
      setMemberState({
        kind: "error",
        message: messageOf(error, "The removal failed. Try again."),
      });
    }
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeleteState({ kind: "busy" });
    try {
      await deleteOrganization(apiBaseUrl, organization.id, confirmSlug);
      router.push("/organizations");
      router.refresh();
    } catch (error) {
      setDeleteState({
        kind: "error",
        message: messageOf(error, "Deletion failed. Try again."),
      });
    }
  }

  return (
    <>
      <section aria-labelledby="your-role-heading" className="account-section">
        <h2 id="your-role-heading">Your role</h2>
        <p>
          You are {roleLabels[membership.role]} in this organization. What you
          see here mirrors what that role allows; the API enforces it.
        </p>
      </section>

      {permissions.includes("organization.settings.update") ? (
        <section aria-labelledby="settings-heading" className="account-section">
          <h2 id="settings-heading">Settings</h2>
          <form className="auth-form" onSubmit={handleRename}>
            <div className="form-field">
              <label htmlFor="org-rename">Organization name</label>
              <input
                defaultValue={organization.name}
                id="org-rename"
                maxLength={160}
                minLength={3}
                name="name"
                required
                type="text"
              />
            </div>
            <button
              className="button-primary"
              disabled={settingsState.kind === "busy"}
              type="submit"
            >
              {settingsState.kind === "busy" ? "Saving..." : "Save name"}
            </button>
            {statusLine(settingsState)}
          </form>
        </section>
      ) : null}

      {members ? (
        <section aria-labelledby="members-heading" className="account-section">
          <h2 id="members-heading">Members</h2>
          <ul className="org-list">
            {members.map((member) => (
              <li key={member.membershipId}>
                <div>
                  <p className="org-list__name">
                    {member.email}
                    {member.userId === currentUserId ? (
                      <span className="session-list__current">You</span>
                    ) : null}
                    {member.status === "invited" ? (
                      <span className="role-badge role-badge--pending">
                        Invited
                      </span>
                    ) : null}
                  </p>
                  <p className="org-list__meta">
                    {member.joinedAt
                      ? `Joined ${formatTimestamp(member.joinedAt)}`
                      : "Has not accepted yet"}
                  </p>
                </div>
                <div className="org-list__actions">
                  {permissions.includes("members.role.update") &&
                  canManage(member) ? (
                    <label className="member-role-control">
                      <span className="sr-only">Role for {member.email}</span>
                      <select
                        defaultValue={member.role}
                        disabled={memberState.kind === "busy"}
                        onChange={(event) =>
                          void handleRoleChange(
                            member,
                            event.target.value as MembershipRole
                          )
                        }
                      >
                        {membership.assignableRoles.map((role) => (
                          <option key={role} value={role}>
                            {roleLabels[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="role-badge">
                      {roleLabels[member.role]}
                    </span>
                  )}
                  {(permissions.includes("members.remove") &&
                    canManage(member)) ||
                  member.userId === currentUserId ? (
                    <button
                      className="button-quiet button-quiet--danger"
                      disabled={memberState.kind === "busy"}
                      onClick={() => void handleRemove(member)}
                      type="button"
                    >
                      {member.userId === currentUserId ? "Leave" : "Remove"}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {statusLine(memberState)}

          {permissions.includes("members.invite") ? (
            <form className="auth-form" onSubmit={handleInvite}>
              <h3 className="org-subheading">Invite a member</h3>
              <div className="form-field">
                <label htmlFor="invite-email">Email address</label>
                <input
                  autoComplete="off"
                  id="invite-email"
                  name="email"
                  required
                  type="email"
                />
              </div>
              <div className="form-field">
                <label htmlFor="invite-role">Role</label>
                <select defaultValue="viewer" id="invite-role" name="role">
                  {membership.assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="button-primary"
                disabled={inviteState.kind === "busy"}
                type="submit"
              >
                {inviteState.kind === "busy" ? "Inviting..." : "Send invite"}
              </button>
              {statusLine(inviteState)}
            </form>
          ) : null}
        </section>
      ) : null}

      {auditEntries ? (
        <section aria-labelledby="audit-heading" className="account-section">
          <h2 id="audit-heading">Audit log</h2>
          <p>Privileged changes, newest first.</p>
          {auditEntries.length === 0 ? (
            <p className="form-status">No entries yet.</p>
          ) : (
            <ul className="org-list org-list--compact">
              {auditEntries.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <p className="org-list__name">{entry.action}</p>
                    <p className="org-list__meta">
                      {entry.actorEmail ?? "system"},{" "}
                      {formatTimestamp(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {permissions.includes("organization.delete") ? (
        <section
          aria-labelledby="danger-heading"
          className="account-section danger-zone"
        >
          <h2 id="danger-heading">Delete organization</h2>
          <p>
            Deletion removes every membership and cannot be undone. Type the URL
            name to confirm.
          </p>
          <form className="auth-form" onSubmit={handleDelete}>
            <div className="form-field">
              <label htmlFor="confirm-slug">
                Type {organization.slug} to confirm
              </label>
              <input
                autoComplete="off"
                id="confirm-slug"
                onChange={(event) => setConfirmSlug(event.target.value)}
                type="text"
                value={confirmSlug}
              />
            </div>
            <button
              className="button-primary button-primary--danger"
              disabled={
                deleteState.kind === "busy" || confirmSlug !== organization.slug
              }
              type="submit"
            >
              {deleteState.kind === "busy"
                ? "Deleting..."
                : "Delete organization"}
            </button>
            {statusLine(deleteState)}
          </form>
        </section>
      ) : null}
    </>
  );
}
