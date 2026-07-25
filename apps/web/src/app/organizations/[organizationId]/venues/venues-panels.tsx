"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type { VenueSummary } from "@event-ticketing/contracts";

import { AuthApiError } from "../../../../lib/auth-api";
import { createVenue } from "../../../../lib/venue-api";

type ActionState =
  { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string };

const numberFormat = new Intl.NumberFormat("en-GB");

export function VenuesPanels({
  apiBaseUrl,
  canManage,
  organizationId,
  venues,
}: Readonly<{
  apiBaseUrl: string;
  canManage: boolean;
  organizationId: string;
  venues: readonly VenueSummary[];
}>): ReactNode {
  const router = useRouter();
  const [createState, setCreateState] = useState<ActionState>({
    kind: "idle",
  });

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const description = String(form.get("description") ?? "").trim();
    setCreateState({ kind: "busy" });
    try {
      const created = await createVenue(apiBaseUrl, organizationId, {
        name,
        ...(description ? { description } : {}),
      });
      router.push(
        `/organizations/${organizationId}/venues/${created.venue.id}`
      );
      router.refresh();
    } catch (error) {
      setCreateState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "Creating the venue failed. Try again.",
      });
    }
  }

  return (
    <>
      <section aria-labelledby="venues-heading" className="account-section">
        <h2 id="venues-heading">Venue templates</h2>
        {venues.length === 0 ? (
          <p className="form-status">
            No venues yet.{" "}
            {canManage
              ? "Create the first one below."
              : "A venue manager creates them."}
          </p>
        ) : (
          <ul className="org-list">
            {venues.map((venue) => (
              <li key={venue.id}>
                <div>
                  <p className="org-list__name">
                    <a
                      href={`/organizations/${organizationId}/venues/${venue.id}`}
                    >
                      {venue.name}
                    </a>
                  </p>
                  <p className="org-list__meta">
                    {numberFormat.format(venue.sectionCount)} sections,{" "}
                    {numberFormat.format(venue.seatCount)} seats (
                    {numberFormat.format(venue.accessibleSeatCount)}{" "}
                    accessible),{" "}
                    {numberFormat.format(venue.generalAdmissionCapacity)}{" "}
                    general admission
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section
          aria-labelledby="create-venue-heading"
          className="account-section"
        >
          <h2 id="create-venue-heading">Create a venue</h2>
          <form className="auth-form" onSubmit={handleCreate}>
            <div className="form-field">
              <label htmlFor="venue-name">Venue name</label>
              <input
                id="venue-name"
                maxLength={120}
                minLength={3}
                name="name"
                required
                type="text"
              />
            </div>
            <div className="form-field">
              <label htmlFor="venue-description">Description (optional)</label>
              <input
                id="venue-description"
                maxLength={400}
                name="description"
                type="text"
              />
            </div>
            <button
              className="button-primary"
              disabled={createState.kind === "busy"}
              type="submit"
            >
              {createState.kind === "busy" ? "Creating..." : "Create venue"}
            </button>
            <p aria-live="polite" className="form-status form-status--error">
              {createState.kind === "error"
                ? `Error: ${createState.message}`
                : ""}
            </p>
          </form>
        </section>
      ) : null}
    </>
  );
}
