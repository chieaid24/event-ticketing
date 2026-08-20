"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import {
  validateVenueLayout,
  venueLayoutSchema,
  type AssignedSection,
  type LayoutRow,
  type VenueDetailResponse,
  type VenueLayout,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../../../../lib/auth-api";
import {
  deleteVenue,
  replaceVenueLayout,
  updateVenue,
} from "../../../../../lib/venue-api";

type ActionState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const numberFormat = new Intl.NumberFormat("en-GB");

const exampleLayout: VenueLayout = {
  sections: [
    {
      kind: "assigned",
      name: "Stalls",
      rows: [
        {
          label: "A",
          seats: [
            { accessible: false, companion: false, label: "1", x: 0, y: 0 },
            { accessible: false, companion: false, label: "2", x: 1, y: 0 },
            { accessible: true, companion: false, label: "3", x: 3, y: 0 },
            { accessible: false, companion: true, label: "4", x: 4, y: 0 },
          ],
        },
        {
          label: "B",
          seats: [
            { accessible: false, companion: false, label: "1", x: 0, y: 1 },
            { accessible: false, companion: false, label: "2", x: 1, y: 1 },
            { accessible: false, companion: false, label: "3", x: 3, y: 1 },
            { accessible: false, companion: false, label: "4", x: 4, y: 1 },
          ],
        },
      ],
    },
    { capacity: 250, kind: "general_admission", name: "Standing Floor" },
  ],
};

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

function checkLayoutText(
  text: string
): { issues: string[] } | { layout: VenueLayout } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { issues: ["The layout is not valid JSON."] };
  }
  const parsed = venueLayoutSchema.safeParse(raw);
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
  const issues = validateVenueLayout(parsed.data);
  return issues.length > 0 ? { issues } : { layout: parsed.data };
}

function sectionSeatCount(section: AssignedSection): number {
  return section.rows.reduce((total, row) => total + row.seats.length, 0);
}

function sectionAccessibleCount(section: AssignedSection): number {
  return section.rows.reduce(
    (total, row) => total + row.seats.filter((seat) => seat.accessible).length,
    0
  );
}

function RowPreview({ row }: Readonly<{ row: LayoutRow }>): ReactNode {
  const seats = [...row.seats].sort((a, b) => a.x - b.x);
  const chips: ReactNode[] = [];
  let previousX: number | null = null;
  for (const seat of seats) {
    if (previousX !== null && seat.x - previousX > 1) {
      chips.push(
        <span
          aria-hidden="true"
          className="seat-chip seat-chip--gap"
          key={`gap-${String(seat.x)}`}
        />
      );
    }
    previousX = seat.x;
    const kind = seat.accessible
      ? "accessible"
      : seat.companion
        ? "companion"
        : null;
    chips.push(
      <span
        className={`seat-chip${kind ? ` seat-chip--${kind}` : ""}`}
        key={seat.label}
      >
        {seat.label}
        {kind ? (
          <>
            <span aria-hidden="true" className="seat-chip__marker">
              {kind === "accessible" ? "A" : "C"}
            </span>
            <span className="sr-only">({kind} seat)</span>
          </>
        ) : null}
      </span>
    );
  }
  return (
    <div className="seat-preview__row">
      <span className="seat-preview__row-label">{row.label}</span>
      {chips}
    </div>
  );
}

export function VenueDetailPanels({
  apiBaseUrl,
  canManage,
  detail,
  organizationId,
}: Readonly<{
  apiBaseUrl: string;
  canManage: boolean;
  detail: VenueDetailResponse;
  organizationId: string;
}>): ReactNode {
  const router = useRouter();
  const { layout, venue } = detail;
  const [detailsState, setDetailsState] = useState<ActionState>({
    kind: "idle",
  });
  const [layoutState, setLayoutState] = useState<ActionState>({
    kind: "idle",
  });
  const [deleteState, setDeleteState] = useState<ActionState>({
    kind: "idle",
  });
  const [layoutText, setLayoutText] = useState(() =>
    JSON.stringify(layout, null, 2)
  );
  const [layoutIssues, setLayoutIssues] = useState<string[] | null>(null);
  const [confirmName, setConfirmName] = useState("");

  async function handleDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const description = String(form.get("description") ?? "").trim();
    setDetailsState({ kind: "busy" });
    try {
      await updateVenue(apiBaseUrl, organizationId, venue.id, {
        name,
        version: venue.version,
        ...(description ? { description } : {}),
      });
      setDetailsState({ kind: "success", message: "Details saved." });
      router.refresh();
    } catch (error) {
      setDetailsState({
        kind: "error",
        message: messageOf(error, "Saving failed. Try again."),
      });
      router.refresh();
    }
  }

  function handleCheckLayout() {
    const outcome = checkLayoutText(layoutText);
    if ("issues" in outcome) {
      setLayoutIssues(outcome.issues);
      return false;
    }
    setLayoutIssues([]);
    return true;
  }

  async function handleSaveLayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = checkLayoutText(layoutText);
    if ("issues" in outcome) {
      setLayoutIssues(outcome.issues);
      return;
    }
    setLayoutIssues(null);
    setLayoutState({ kind: "busy" });
    try {
      await replaceVenueLayout(apiBaseUrl, organizationId, venue.id, {
        layout: outcome.layout,
        version: venue.version,
      });
      setLayoutState({ kind: "success", message: "Layout saved." });
      router.refresh();
    } catch (error) {
      setLayoutState({
        kind: "error",
        message: messageOf(error, "Saving the layout failed. Try again."),
      });
      router.refresh();
    }
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeleteState({ kind: "busy" });
    try {
      await deleteVenue(apiBaseUrl, organizationId, venue.id);
      router.push(`/organizations/${organizationId}/venues`);
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
      <section aria-labelledby="preview-heading" className="account-section">
        <h2 id="preview-heading">Layout preview</h2>
        {layout.sections.length === 0 ? (
          <p className="form-status">
            This venue has no sections yet.
            {canManage ? " Import a layout below." : ""}
          </p>
        ) : (
          <>
            <p className="seat-legend">
              <span className="seat-chip">1</span> standard
              <span className="seat-chip seat-chip--accessible">
                1
                <span aria-hidden="true" className="seat-chip__marker">
                  A
                </span>
              </span>{" "}
              accessible
              <span className="seat-chip seat-chip--companion">
                1
                <span aria-hidden="true" className="seat-chip__marker">
                  C
                </span>
              </span>{" "}
              companion
            </p>
            {layout.sections.map((section) => (
              <div className="seat-preview" key={section.name}>
                <h3 className="org-subheading">{section.name}</h3>
                {section.kind === "assigned" ? (
                  section.rows.map((row) => (
                    <RowPreview key={row.label} row={row} />
                  ))
                ) : (
                  <p className="org-list__meta">
                    General admission for{" "}
                    {numberFormat.format(section.capacity)} people.
                  </p>
                )}
              </div>
            ))}
            <h3 className="org-subheading">Section summary</h3>
            <table className="data-table">
              <caption className="sr-only">
                Seat counts for each section
              </caption>
              <thead>
                <tr>
                  <th scope="col">Section</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Accessible</th>
                  <th scope="col">Capacity</th>
                </tr>
              </thead>
              <tbody>
                {layout.sections.map((section) => (
                  <tr key={section.name}>
                    <th scope="row">{section.name}</th>
                    {section.kind === "assigned" ? (
                      <>
                        <td>Assigned</td>
                        <td>{numberFormat.format(section.rows.length)}</td>
                        <td>
                          {numberFormat.format(sectionSeatCount(section))}
                        </td>
                        <td>
                          {numberFormat.format(sectionAccessibleCount(section))}
                        </td>
                        <td>-</td>
                      </>
                    ) : (
                      <>
                        <td>General admission</td>
                        <td>-</td>
                        <td>-</td>
                        <td>-</td>
                        <td>{numberFormat.format(section.capacity)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {canManage ? (
        <>
          <section
            aria-labelledby="details-heading"
            className="account-section"
          >
            <h2 id="details-heading">Details</h2>
            <form className="auth-form" onSubmit={handleDetails}>
              <div className="form-field">
                <label htmlFor="venue-name">Venue name</label>
                <input
                  defaultValue={venue.name}
                  id="venue-name"
                  maxLength={120}
                  minLength={3}
                  name="name"
                  required
                  type="text"
                />
              </div>
              <div className="form-field">
                <label htmlFor="venue-description">
                  Description (optional)
                </label>
                <input
                  defaultValue={venue.description ?? ""}
                  id="venue-description"
                  maxLength={400}
                  name="description"
                  type="text"
                />
              </div>
              <button
                className="button-primary"
                disabled={detailsState.kind === "busy"}
                type="submit"
              >
                {detailsState.kind === "busy" ? "Saving..." : "Save details"}
              </button>
              {statusLine(detailsState)}
            </form>
          </section>

          <section aria-labelledby="layout-heading" className="account-section">
            <h2 id="layout-heading">Layout</h2>
            <p>
              Edit or paste the layout document, check it, then save. Saving
              replaces the whole template; published events keep their own seat
              snapshots.
            </p>
            <form
              className="auth-form auth-form--full"
              onSubmit={handleSaveLayout}
            >
              <div className="form-field">
                <label htmlFor="layout-json">Layout document (JSON)</label>
                <textarea
                  className="layout-editor"
                  id="layout-json"
                  name="layout"
                  onChange={(event) => {
                    setLayoutText(event.target.value);
                    setLayoutIssues(null);
                  }}
                  rows={14}
                  spellCheck={false}
                  value={layoutText}
                />
                <p className="field-hint">
                  Sections are assigned (rows of seats with x and y grid
                  positions) or general admission (a capacity). Companion seats
                  must sit directly beside an accessible seat.
                </p>
              </div>
              {layoutIssues !== null ? (
                layoutIssues.length === 0 ? (
                  <p
                    aria-live="polite"
                    className="form-status form-status--success"
                  >
                    The layout is valid.
                  </p>
                ) : (
                  <div className="validation-summary" role="alert">
                    <p>
                      The layout has {numberFormat.format(layoutIssues.length)}{" "}
                      {layoutIssues.length === 1 ? "problem" : "problems"}:
                    </p>
                    <ul>
                      {layoutIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )
              ) : null}
              <div className="org-list__actions">
                <button
                  className="button-quiet"
                  onClick={handleCheckLayout}
                  type="button"
                >
                  Check layout
                </button>
                <button
                  className="button-quiet"
                  onClick={() => {
                    setLayoutText(JSON.stringify(exampleLayout, null, 2));
                    setLayoutIssues(null);
                  }}
                  type="button"
                >
                  Insert example
                </button>
                <button
                  className="button-primary"
                  disabled={layoutState.kind === "busy"}
                  type="submit"
                >
                  {layoutState.kind === "busy" ? "Saving..." : "Save layout"}
                </button>
              </div>
              {statusLine(layoutState)}
            </form>
          </section>

          <section
            aria-labelledby="venue-danger-heading"
            className="account-section danger-zone"
          >
            <h2 id="venue-danger-heading">Delete venue</h2>
            <p>
              Deletion removes the template and its layout and cannot be undone.
              Type the venue name to confirm.
            </p>
            <form className="auth-form" onSubmit={handleDelete}>
              <div className="form-field">
                <label htmlFor="confirm-venue-name">
                  Type {venue.name} to confirm
                </label>
                <input
                  autoComplete="off"
                  id="confirm-venue-name"
                  onChange={(event) => setConfirmName(event.target.value)}
                  type="text"
                  value={confirmName}
                />
              </div>
              <button
                className="button-primary button-primary--danger"
                disabled={
                  deleteState.kind === "busy" || confirmName !== venue.name
                }
                type="submit"
              >
                {deleteState.kind === "busy" ? "Deleting..." : "Delete venue"}
              </button>
              {statusLine(deleteState)}
            </form>
          </section>
        </>
      ) : null}
    </>
  );
}
