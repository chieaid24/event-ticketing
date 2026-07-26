"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import type {
  EventStatus,
  EventSummary,
  VenueSummary,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../../../lib/auth-api";
import { createEvent } from "../../../../lib/event-api";

type ActionState =
  { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string };

const numberFormat = new Intl.NumberFormat("en-GB");
const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const statusLabels: Record<EventStatus, string> = {
  archived: "Archived",
  cancelled: "Cancelled",
  completed: "Completed",
  draft: "Draft",
  postponed: "Postponed",
  published: "Published",
  sales_paused: "Sales paused",
};

function formatStart(iso: string | null): string {
  return iso ? `${timestampFormat.format(new Date(iso))} UTC` : "No date yet";
}

export function EventsPanels({
  apiBaseUrl,
  canManage,
  events,
  organizationId,
  venues,
}: Readonly<{
  apiBaseUrl: string;
  canManage: boolean;
  events: readonly EventSummary[];
  organizationId: string;
  venues: readonly VenueSummary[];
}>): ReactNode {
  const router = useRouter();
  const [createState, setCreateState] = useState<ActionState>({ kind: "idle" });

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "");
    const venueId = String(form.get("venueId") ?? "");
    setCreateState({ kind: "busy" });
    try {
      const created = await createEvent(apiBaseUrl, organizationId, {
        title,
        venueId,
      });
      router.push(
        `/organizations/${organizationId}/events/${created.event.id}`
      );
      router.refresh();
    } catch (error) {
      setCreateState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "Creating the event failed. Try again.",
      });
    }
  }

  return (
    <>
      <section aria-labelledby="events-heading" className="account-section">
        <h2 id="events-heading">Your events</h2>
        {events.length === 0 ? (
          <p className="form-status">
            No events yet.{" "}
            {canManage
              ? "Draft the first one below."
              : "An event manager creates them."}
          </p>
        ) : (
          <ul className="org-list">
            {events.map((event) => (
              <li key={event.id}>
                <div>
                  <p className="org-list__name">
                    <a
                      href={`/organizations/${organizationId}/events/${event.id}`}
                    >
                      {event.title}
                    </a>
                    <span
                      className={`role-badge${
                        event.status === "draft" ? " role-badge--pending" : ""
                      }`}
                    >
                      {statusLabels[event.status]}
                    </span>
                  </p>
                  <p className="org-list__meta">
                    {event.venueName}, {formatStart(event.startsAt)},{" "}
                    {numberFormat.format(event.ticketTypeCount)} ticket types,{" "}
                    {numberFormat.format(event.capacity)} capacity
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section
          aria-labelledby="create-event-heading"
          className="account-section"
        >
          <h2 id="create-event-heading">Draft an event</h2>
          {venues.length === 0 ? (
            <p className="form-status">
              Create a venue first. An event references a venue and snapshots
              its seats at publication.
            </p>
          ) : (
            <form className="auth-form" onSubmit={handleCreate}>
              <div className="form-field">
                <label htmlFor="event-title">Event title</label>
                <input
                  id="event-title"
                  maxLength={140}
                  minLength={3}
                  name="title"
                  required
                  type="text"
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-venue">Venue</label>
                <select id="event-venue" name="venueId" required>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="button-primary"
                disabled={createState.kind === "busy"}
                type="submit"
              >
                {createState.kind === "busy" ? "Drafting..." : "Draft event"}
              </button>
              <p aria-live="polite" className="form-status form-status--error">
                {createState.kind === "error"
                  ? `Error: ${createState.message}`
                  : ""}
              </p>
            </form>
          )}
        </section>
      ) : null}
    </>
  );
}
