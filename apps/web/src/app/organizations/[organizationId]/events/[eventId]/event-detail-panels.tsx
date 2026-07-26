"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import {
  supportedCurrencies,
  ticketTypeInputSchema,
  type EventDetailResponse,
  type TicketType,
  type TicketTypeInput,
  type UpdateEventDraftRequest,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../../../../lib/auth-api";
import {
  publishEvent,
  replaceTicketTypes,
  updateEventDraft,
} from "../../../../../lib/event-api";

type ActionState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const numberFormat = new Intl.NumberFormat("en-GB");
const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

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

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    currency,
    style: "currency",
  }).format(minor / 100);
}

function formatInstant(iso: string | null): string {
  return iso ? `${timestampFormat.format(new Date(iso))} UTC` : "Not set";
}

/** ISO instant to a datetime-local value in UTC (YYYY-MM-DDTHH:mm). */
function isoToInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : "";
}

/** A datetime-local value is read as a UTC wall-clock instant. */
function inputToIso(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function trimmedOrNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function toEditableTicketTypes(ticketTypes: readonly TicketType[]): unknown[] {
  return ticketTypes.map((ticketType) =>
    ticketType.kind === "assigned"
      ? {
          feeMinor: ticketType.feeMinor,
          kind: "assigned",
          name: ticketType.name,
          priceMinor: ticketType.priceMinor,
          sectionName: ticketType.sectionName,
        }
      : {
          capacity: ticketType.capacity ?? 0,
          feeMinor: ticketType.feeMinor,
          kind: "general_admission",
          name: ticketType.name,
          priceMinor: ticketType.priceMinor,
          sectionName: ticketType.sectionName,
        }
  );
}

/** Parses editor text into ticket types, or a complete list of problems. */
function checkTicketTypesText(
  text: string
): { issues: string[] } | { ticketTypes: TicketTypeInput[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { issues: ["The ticket types are not valid JSON."] };
  }
  const parsed = ticketTypeInputSchema.array().max(50).safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues
        .slice(0, 20)
        .map((issue) =>
          issue.path.length > 0
            ? `${issue.path.join(".")}: ${issue.message}`
            : issue.message
        ),
    };
  }
  return { ticketTypes: parsed.data };
}

export function EventDetailPanels({
  apiBaseUrl,
  canManage,
  detail,
  organizationId,
}: Readonly<{
  apiBaseUrl: string;
  canManage: boolean;
  detail: EventDetailResponse;
  organizationId: string;
}>): ReactNode {
  const router = useRouter();
  const { availableSections, event, publishIssues, ticketTypes, venue } =
    detail;
  const isDraft = event.status === "draft";
  const [basicsState, setBasicsState] = useState<ActionState>({ kind: "idle" });
  const [ticketState, setTicketState] = useState<ActionState>({ kind: "idle" });
  const [publishState, setPublishState] = useState<ActionState>({
    kind: "idle",
  });
  const [ticketText, setTicketText] = useState(() =>
    JSON.stringify(toEditableTicketTypes(ticketTypes), null, 2)
  );
  const [ticketIssues, setTicketIssues] = useState<string[] | null>(null);

  async function handleBasics(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = new FormData(formEvent.currentTarget);
    const request: UpdateEventDraftRequest = {
      currency: String(
        form.get("currency") ?? "USD"
      ) as UpdateEventDraftRequest["currency"],
      description: trimmedOrNull(form.get("description")),
      endsAt: inputToIso(String(form.get("endsAt") ?? "")),
      holdDurationSeconds: Number(form.get("holdDurationSeconds") ?? 600),
      mediaUrl: trimmedOrNull(form.get("mediaUrl")),
      refundPolicy: trimmedOrNull(form.get("refundPolicy")),
      salesEndAt: inputToIso(String(form.get("salesEndAt") ?? "")),
      salesStartAt: inputToIso(String(form.get("salesStartAt") ?? "")),
      startsAt: inputToIso(String(form.get("startsAt") ?? "")),
      timezone: String(form.get("timezone") ?? "UTC"),
      title: String(form.get("title") ?? ""),
      version: event.version,
    };
    setBasicsState({ kind: "busy" });
    try {
      await updateEventDraft(apiBaseUrl, organizationId, event.id, request);
      setBasicsState({ kind: "success", message: "Details saved." });
      router.refresh();
    } catch (error) {
      setBasicsState({
        kind: "error",
        message: messageOf(error, "Saving failed. Try again."),
      });
      router.refresh();
    }
  }

  function handleCheckTickets() {
    const outcome = checkTicketTypesText(ticketText);
    setTicketIssues("issues" in outcome ? outcome.issues : []);
  }

  async function handleSaveTickets(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const outcome = checkTicketTypesText(ticketText);
    if ("issues" in outcome) {
      setTicketIssues(outcome.issues);
      return;
    }
    setTicketIssues(null);
    setTicketState({ kind: "busy" });
    try {
      await replaceTicketTypes(apiBaseUrl, organizationId, event.id, {
        ticketTypes: outcome.ticketTypes,
        version: event.version,
      });
      setTicketState({ kind: "success", message: "Ticket types saved." });
      router.refresh();
    } catch (error) {
      setTicketState({
        kind: "error",
        message: messageOf(error, "Saving the ticket types failed. Try again."),
      });
      router.refresh();
    }
  }

  async function handlePublish(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setPublishState({ kind: "busy" });
    try {
      await publishEvent(apiBaseUrl, organizationId, event.id, {
        version: event.version,
      });
      setPublishState({ kind: "success", message: "Event published." });
      router.refresh();
    } catch (error) {
      setPublishState({
        kind: "error",
        message: messageOf(error, "Publishing failed. Try again."),
      });
      router.refresh();
    }
  }

  return (
    <>
      <section aria-labelledby="overview-heading" className="account-section">
        <h2 id="overview-heading">Overview</h2>
        <table className="data-table">
          <caption className="sr-only">Event configuration summary</caption>
          <tbody>
            <tr>
              <th scope="row">Status</th>
              <td>{isDraft ? "Draft" : "Published"}</td>
            </tr>
            <tr>
              <th scope="row">Venue</th>
              <td>{venue.name}</td>
            </tr>
            <tr>
              <th scope="row">Time zone</th>
              <td>{event.timezone}</td>
            </tr>
            <tr>
              <th scope="row">Currency</th>
              <td>{event.currency}</td>
            </tr>
            <tr>
              <th scope="row">Starts</th>
              <td>{formatInstant(event.startsAt)}</td>
            </tr>
            <tr>
              <th scope="row">Ends</th>
              <td>{formatInstant(event.endsAt)}</td>
            </tr>
            <tr>
              <th scope="row">Sales open</th>
              <td>{formatInstant(event.salesStartAt)}</td>
            </tr>
            <tr>
              <th scope="row">Sales close</th>
              <td>{formatInstant(event.salesEndAt)}</td>
            </tr>
            <tr>
              <th scope="row">Hold duration</th>
              <td>{numberFormat.format(event.holdDurationSeconds)} seconds</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section
        aria-labelledby="ticket-summary-heading"
        className="account-section"
      >
        <h2 id="ticket-summary-heading">Ticket types</h2>
        {ticketTypes.length === 0 ? (
          <p className="form-status">
            No ticket types yet.
            {canManage && isDraft ? " Configure them below." : ""}
          </p>
        ) : (
          <table className="data-table">
            <caption className="sr-only">Configured ticket types</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">Section</th>
                <th scope="col">Price</th>
                <th scope="col">Fee</th>
                <th scope="col">Capacity</th>
              </tr>
            </thead>
            <tbody>
              {ticketTypes.map((ticketType) => (
                <tr key={ticketType.id}>
                  <th scope="row">{ticketType.name}</th>
                  <td>
                    {ticketType.kind === "assigned"
                      ? "Assigned"
                      : "General admission"}
                  </td>
                  <td>{ticketType.sectionName}</td>
                  <td>{formatMoney(ticketType.priceMinor, event.currency)}</td>
                  <td>{formatMoney(ticketType.feeMinor, event.currency)}</td>
                  <td>
                    {ticketType.capacity === null
                      ? "By seat"
                      : numberFormat.format(ticketType.capacity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canManage && isDraft ? (
        <>
          <section aria-labelledby="basics-heading" className="account-section">
            <h2 id="basics-heading">Basics</h2>
            <p>
              Drafts save with a version. If someone else saved a newer version
              first, your save is rejected so no edit is silently overwritten.
            </p>
            <form className="auth-form" onSubmit={handleBasics}>
              <div className="form-field">
                <label htmlFor="event-title">Title</label>
                <input
                  defaultValue={event.title}
                  id="event-title"
                  maxLength={140}
                  minLength={3}
                  name="title"
                  required
                  type="text"
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-description">
                  Description (optional)
                </label>
                <textarea
                  defaultValue={event.description ?? ""}
                  id="event-description"
                  maxLength={2000}
                  name="description"
                  rows={3}
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-timezone">Time zone (IANA)</label>
                <input
                  defaultValue={event.timezone}
                  id="event-timezone"
                  maxLength={64}
                  name="timezone"
                  required
                  type="text"
                />
                <p className="field-hint">
                  For example America/Toronto or Europe/London.
                </p>
              </div>
              <div className="form-field">
                <label htmlFor="event-currency">Currency</label>
                <select
                  defaultValue={event.currency}
                  id="event-currency"
                  name="currency"
                >
                  {supportedCurrencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="event-starts">Starts (UTC)</label>
                <input
                  defaultValue={isoToInput(event.startsAt)}
                  id="event-starts"
                  name="startsAt"
                  type="datetime-local"
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-ends">Ends (UTC)</label>
                <input
                  defaultValue={isoToInput(event.endsAt)}
                  id="event-ends"
                  name="endsAt"
                  type="datetime-local"
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-sales-start">Sales open (UTC)</label>
                <input
                  defaultValue={isoToInput(event.salesStartAt)}
                  id="event-sales-start"
                  name="salesStartAt"
                  type="datetime-local"
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-sales-end">Sales close (UTC)</label>
                <input
                  defaultValue={isoToInput(event.salesEndAt)}
                  id="event-sales-end"
                  name="salesEndAt"
                  type="datetime-local"
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-hold">Hold duration (seconds)</label>
                <input
                  defaultValue={event.holdDurationSeconds}
                  id="event-hold"
                  max={86400}
                  min={60}
                  name="holdDurationSeconds"
                  required
                  type="number"
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-refund">Refund policy (optional)</label>
                <textarea
                  defaultValue={event.refundPolicy ?? ""}
                  id="event-refund"
                  maxLength={2000}
                  name="refundPolicy"
                  rows={2}
                />
              </div>
              <div className="form-field">
                <label htmlFor="event-media">Media URL (optional)</label>
                <input
                  defaultValue={event.mediaUrl ?? ""}
                  id="event-media"
                  maxLength={2048}
                  name="mediaUrl"
                  type="url"
                />
              </div>
              <button
                className="button-primary"
                disabled={basicsState.kind === "busy"}
                type="submit"
              >
                {basicsState.kind === "busy" ? "Saving..." : "Save basics"}
              </button>
              {statusLine(basicsState)}
            </form>
          </section>

          <section
            aria-labelledby="sections-heading"
            className="account-section"
          >
            <h2 id="sections-heading">Venue sections</h2>
            <p>
              Reference the section names below when configuring ticket types.
            </p>
            {availableSections.length === 0 ? (
              <p className="form-status">
                This venue has no sections. Add a layout to the venue first.
              </p>
            ) : (
              <table className="data-table">
                <caption className="sr-only">
                  Sections available from the venue
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Section</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Seats</th>
                    <th scope="col">Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {availableSections.map((section) => (
                    <tr key={section.name}>
                      <th scope="row">{section.name}</th>
                      <td>
                        {section.kind === "assigned"
                          ? "Assigned"
                          : "General admission"}
                      </td>
                      <td>
                        {section.kind === "assigned"
                          ? numberFormat.format(section.seatCount)
                          : "-"}
                      </td>
                      <td>
                        {section.kind === "general_admission"
                          ? numberFormat.format(section.capacity)
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section
            aria-labelledby="tickets-heading"
            className="account-section"
          >
            <h2 id="tickets-heading">Configure ticket types</h2>
            <p>
              Edit the ticket types document, check it, then save. Assigned
              types draw seats from their section; general admission carries a
              capacity. Prices are in minor units, for example cents.
            </p>
            <form
              className="auth-form auth-form--full"
              onSubmit={handleSaveTickets}
            >
              <div className="form-field">
                <label htmlFor="ticket-json">Ticket types (JSON)</label>
                <textarea
                  className="layout-editor"
                  id="ticket-json"
                  name="ticketTypes"
                  onChange={(changeEvent) => {
                    setTicketText(changeEvent.target.value);
                    setTicketIssues(null);
                  }}
                  rows={12}
                  spellCheck={false}
                  value={ticketText}
                />
              </div>
              {ticketIssues !== null ? (
                ticketIssues.length === 0 ? (
                  <p
                    aria-live="polite"
                    className="form-status form-status--success"
                  >
                    The ticket types are valid.
                  </p>
                ) : (
                  <div className="validation-summary" role="alert">
                    <p>
                      The ticket types have{" "}
                      {numberFormat.format(ticketIssues.length)}{" "}
                      {ticketIssues.length === 1 ? "problem" : "problems"}:
                    </p>
                    <ul>
                      {ticketIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )
              ) : null}
              <div className="org-list__actions">
                <button
                  className="button-quiet"
                  onClick={handleCheckTickets}
                  type="button"
                >
                  Check ticket types
                </button>
                <button
                  className="button-primary"
                  disabled={ticketState.kind === "busy"}
                  type="submit"
                >
                  {ticketState.kind === "busy"
                    ? "Saving..."
                    : "Save ticket types"}
                </button>
              </div>
              {statusLine(ticketState)}
            </form>
          </section>

          <section
            aria-labelledby="publish-heading"
            className="account-section"
          >
            <h2 id="publish-heading">Review and publish</h2>
            {publishIssues.length > 0 ? (
              <div className="validation-summary" role="alert">
                <p>
                  Resolve {numberFormat.format(publishIssues.length)}{" "}
                  {publishIssues.length === 1 ? "problem" : "problems"} before
                  publishing:
                </p>
                <ul>
                  {publishIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="form-status form-status--success">
                This event is ready to publish.
              </p>
            )}
            <form className="auth-form" onSubmit={handlePublish}>
              <button
                className="button-primary"
                disabled={
                  publishState.kind === "busy" || publishIssues.length > 0
                }
                type="submit"
              >
                {publishState.kind === "busy"
                  ? "Publishing..."
                  : "Publish event"}
              </button>
              {statusLine(publishState)}
            </form>
          </section>
        </>
      ) : (
        <section
          aria-labelledby="published-heading"
          className="account-section"
        >
          <h2 id="published-heading">
            {isDraft ? "Draft" : "Published event"}
          </h2>
          <p>
            {isDraft
              ? "An event manager can edit and publish this draft."
              : "This event is published. Its seats are snapshotted and its configuration is locked."}
          </p>
        </section>
      )}
    </>
  );
}
