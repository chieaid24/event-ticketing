"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type {
  EventAvailabilityResponse,
  PublicSeat,
  PublicSeatSection,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../../lib/auth-api";
import {
  createAssignedSeatHold,
  createGeneralAdmissionHold,
} from "../../../lib/checkout-api";
import { fetchEventAvailability } from "../../../lib/discovery-api";
import { formatMoney } from "../../../lib/format";

const REFRESH_INTERVAL_MS = 60_000;
const MAX_GA_PER_ORDER = 8;

const SEAT_CELL = 44;
const SEAT_PITCH = 52;

type AvailabilityState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      data: EventAvailabilityResponse;
      fetchedAt: string;
      kind: "ready";
      stale: boolean;
    };

interface SelectedSeat {
  id: string;
  priceMinor: number;
  rowLabel: string;
  seatLabel: string;
  sectionName: string;
}

const levelLabels = {
  available: "Available",
  limited: "Limited availability",
  sold_out: "Sold out",
} as const;

const updatedFormat = new Intl.DateTimeFormat("en-GB", {
  timeStyle: "medium",
});

function seatName(seat: { rowLabel: string; seatLabel: string }): string {
  return `Row ${seat.rowLabel} seat ${seat.seatLabel}`;
}

function seatFeatures(seat: PublicSeat): string {
  if (seat.accessible) {
    return "Accessible";
  }
  if (seat.companion) {
    return "Companion seat";
  }
  return "Standard";
}

export function AvailabilityPanels({
  apiBaseUrl,
  currency,
  eventId,
  salesOpen,
  signedIn,
}: Readonly<{
  apiBaseUrl: string;
  currency: string;
  eventId: string;
  salesOpen: boolean;
  signedIn: boolean;
}>): ReactNode {
  const router = useRouter();
  const [state, setState] = useState<AvailabilityState>({ kind: "loading" });
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<
    ReadonlyMap<string, SelectedSeat>
  >(new Map());
  const [gaQuantities, setGaQuantities] = useState<ReadonlyMap<string, number>>(
    new Map()
  );
  const [notice, setNotice] = useState<string | null>(null);

  const applyData = useCallback((data: EventAvailabilityResponse) => {
    setState({
      data,
      fetchedAt: new Date().toISOString(),
      kind: "ready",
      stale: false,
    });
    setSelectedSeats((selection) => {
      if (selection.size === 0) {
        return selection;
      }
      const open = new Set(
        data.sections.flatMap((section) =>
          section.seats
            .filter((seat) => seat.status === "available")
            .map((seat) => seat.id)
        )
      );
      const removed = [...selection.values()].filter(
        (seat) => !open.has(seat.id)
      );
      if (removed.length === 0) {
        return selection;
      }
      setNotice(
        `${removed
          .map((seat) => `${seat.sectionName} ${seatName(seat)}`)
          .join(", ")} ${
          removed.length === 1 ? "is" : "are"
        } no longer available and left your selection.`
      );
      const next = new Map(selection);
      for (const seat of removed) {
        next.delete(seat.id);
      }
      return next;
    });
  }, []);

  // failed refresh keeps last good data, flags it stale
  const markRefreshFailed = useCallback(() => {
    setState((previous) =>
      previous.kind === "ready"
        ? { ...previous, stale: true }
        : { kind: "error" }
    );
  }, []);

  const load = useCallback(async () => {
    try {
      applyData(await fetchEventAvailability(apiBaseUrl, eventId));
    } catch {
      markRefreshFailed();
    }
  }, [apiBaseUrl, eventId, applyData, markRefreshFailed]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      fetchEventAvailability(apiBaseUrl, eventId)
        .then((data) => {
          if (active) {
            applyData(data);
          }
        })
        .catch(() => {
          if (active) {
            markRefreshFailed();
          }
        });
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [apiBaseUrl, eventId, applyData, markRefreshFailed]);

  const toggleSeat = useCallback(
    (sectionName: string, seat: PublicSeat) => {
      if (!salesOpen || seat.status !== "available") {
        return;
      }
      setNotice(null);
      setSelectedSeats((selection) => {
        const next = new Map(selection);
        if (next.has(seat.id)) {
          next.delete(seat.id);
        } else {
          next.set(seat.id, {
            id: seat.id,
            priceMinor: seat.priceMinor,
            rowLabel: seat.rowLabel,
            seatLabel: seat.seatLabel,
            sectionName,
          });
        }
        return next;
      });
    },
    [salesOpen]
  );

  const startCheckoutFlow = useCallback(async () => {
    const seatIds = [...selectedSeats.keys()];
    const items = [...gaQuantities.entries()].map(
      ([ticketTypeId, quantity]) => ({ quantity, ticketTypeId })
    );
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      // random key scopes retries to this attempt
      const idempotencyKey = crypto.randomUUID();
      const hold =
        seatIds.length > 0
          ? await createAssignedSeatHold(
              apiBaseUrl,
              { eventId, seatIds },
              idempotencyKey
            )
          : await createGeneralAdmissionHold(
              apiBaseUrl,
              { eventId, items },
              idempotencyKey
            );
      router.push(`/checkout/${hold.holdId}`);
    } catch (error) {
      setCheckoutBusy(false);
      if (error instanceof AuthApiError) {
        if (error.code === "unauthenticated") {
          router.push("/login");
          return;
        }
        if (
          error.code === "seats_unavailable" ||
          error.code === "capacity_unavailable"
        ) {
          setCheckoutError(
            "Part of your selection was just taken. Availability has been refreshed; adjust your selection and try again."
          );
          void load();
          return;
        }
        setCheckoutError(error.message);
        return;
      }
      setCheckoutError("Starting checkout failed. Try again.");
    }
  }, [apiBaseUrl, eventId, gaQuantities, load, router, selectedSeats]);

  const setGaQuantity = useCallback((ticketTypeId: string, value: number) => {
    setNotice(null);
    const clamped = Math.max(0, Math.min(MAX_GA_PER_ORDER, Math.trunc(value)));
    setGaQuantities((quantities) => {
      const next = new Map(quantities);
      if (clamped === 0) {
        next.delete(ticketTypeId);
      } else {
        next.set(ticketTypeId, clamped);
      }
      return next;
    });
  }, []);

  return (
    <section aria-labelledby="availability-heading" className="account-section">
      <h2 id="availability-heading">Seats and admission</h2>
      {!salesOpen && (
        <p className="form-status" role="status">
          Ticket sales are closed for this event, so selection is disabled.
        </p>
      )}

      {state.kind === "loading" && (
        <p className="form-status" role="status">
          Loading availability&hellip;
        </p>
      )}
      {state.kind === "error" && (
        <p className="form-status form-status--error" role="alert">
          Loading availability failed.{" "}
          <button
            className="button-quiet"
            onClick={() => {
              setState({ kind: "loading" });
              void load();
            }}
            type="button"
          >
            Retry
          </button>
        </p>
      )}

      {state.kind === "ready" && (
        <>
          <div className="availability-toolbar">
            <p
              className={
                state.stale
                  ? "availability-updated availability-updated--stale"
                  : "availability-updated"
              }
              role="status"
            >
              {state.stale
                ? `Refreshing availability failed. Showing data from ${updatedFormat.format(new Date(state.fetchedAt))}.`
                : `Availability as of ${updatedFormat.format(new Date(state.fetchedAt))}. It is advisory and can change until checkout confirms a hold.`}
            </p>
            <button
              className="button-quiet"
              onClick={() => void load()}
              type="button"
            >
              Refresh
            </button>
          </div>

          {notice && (
            <p className="form-status form-status--error" role="status">
              {notice}
            </p>
          )}

          {state.data.sections.length === 0 &&
            state.data.generalAdmission.length === 0 && (
              <p className="form-status" role="status">
                This event has no public inventory to show.
              </p>
            )}

          {state.data.sections.map((section) => (
            <SeatSectionPanel
              currency={currency}
              key={section.name}
              onToggle={toggleSeat}
              salesOpen={salesOpen}
              section={section}
              selectedSeats={selectedSeats}
            />
          ))}

          {state.data.generalAdmission.length > 0 && (
            <section
              aria-labelledby="general-admission-heading"
              className="ga-panel"
            >
              <h3 id="general-admission-heading">General admission</h3>
              <ul className="ga-list">
                {state.data.generalAdmission.map((ticketType) => {
                  const quantity =
                    gaQuantities.get(ticketType.ticketTypeId) ?? 0;
                  const disabled =
                    !salesOpen || ticketType.level === "sold_out";
                  return (
                    <li key={ticketType.ticketTypeId}>
                      <div>
                        <p className="event-list__title">{ticketType.name}</p>
                        <p className="event-list__meta">
                          {formatMoney(ticketType.priceMinor, currency)} plus{" "}
                          {formatMoney(ticketType.feeMinor, currency)} fee{" "}
                          <span
                            className="role-badge"
                            data-level={ticketType.level}
                          >
                            {levelLabels[ticketType.level]}
                          </span>
                        </p>
                      </div>
                      <div className="qty-stepper">
                        <button
                          aria-label={`Fewer ${ticketType.name} tickets`}
                          className="button-quiet"
                          disabled={disabled || quantity === 0}
                          onClick={() =>
                            setGaQuantity(ticketType.ticketTypeId, quantity - 1)
                          }
                          type="button"
                        >
                          -
                        </button>
                        <input
                          aria-label={`${ticketType.name} ticket quantity`}
                          disabled={disabled}
                          inputMode="numeric"
                          max={MAX_GA_PER_ORDER}
                          min={0}
                          onChange={(changeEvent) =>
                            setGaQuantity(
                              ticketType.ticketTypeId,
                              Number(changeEvent.currentTarget.value) || 0
                            )
                          }
                          type="number"
                          value={quantity}
                        />
                        <button
                          aria-label={`More ${ticketType.name} tickets`}
                          className="button-quiet"
                          disabled={disabled || quantity >= MAX_GA_PER_ORDER}
                          onClick={() =>
                            setGaQuantity(ticketType.ticketTypeId, quantity + 1)
                          }
                          type="button"
                        >
                          +
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <SelectionSummary
            busy={checkoutBusy}
            checkoutError={checkoutError}
            currency={currency}
            gaQuantities={gaQuantities}
            generalAdmission={state.data.generalAdmission}
            onCheckout={() => void startCheckoutFlow()}
            salesOpen={salesOpen}
            selectedSeats={selectedSeats}
            signedIn={signedIn}
          />
        </>
      )}
    </section>
  );
}

function SeatSectionPanel({
  currency,
  onToggle,
  salesOpen,
  section,
  selectedSeats,
}: Readonly<{
  currency: string;
  onToggle: (sectionName: string, seat: PublicSeat) => void;
  salesOpen: boolean;
  section: PublicSeatSection;
  selectedSeats: ReadonlyMap<string, SelectedSeat>;
}>): ReactNode {
  const [view, setView] = useState<"list" | "map">("map");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [onlyAccessible, setOnlyAccessible] = useState(false);

  const availableCount = section.seats.filter(
    (seat) => seat.status === "available"
  ).length;
  const sectionSlug = section.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

  const filteredSeats = section.seats.filter(
    (seat) =>
      (!onlyAvailable || seat.status === "available") &&
      (!onlyAccessible || seat.accessible || seat.companion)
  );

  return (
    <section
      aria-labelledby={`section-heading-${sectionSlug}`}
      className="seat-section"
    >
      <div className="seat-section__header">
        <h3 id={`section-heading-${sectionSlug}`}>{section.name}</h3>
        <p className="event-list__meta">
          {availableCount} of {section.seats.length} seats available
        </p>
        <div
          aria-label={`${section.name} view`}
          className="view-toggle"
          role="group"
        >
          <button
            aria-pressed={view === "map"}
            className="button-quiet"
            onClick={() => setView("map")}
            type="button"
          >
            Map view
          </button>
          <button
            aria-pressed={view === "list"}
            className="button-quiet"
            onClick={() => setView("list")}
            type="button"
          >
            List view
          </button>
        </div>
      </div>

      {view === "map" ? (
        <SeatMap
          currency={currency}
          onToggle={onToggle}
          salesOpen={salesOpen}
          section={section}
          selectedSeats={selectedSeats}
        />
      ) : (
        <>
          <div className="seat-filters">
            <label>
              <input
                checked={onlyAvailable}
                onChange={(changeEvent) =>
                  setOnlyAvailable(changeEvent.currentTarget.checked)
                }
                type="checkbox"
              />{" "}
              Only available seats
            </label>
            <label>
              <input
                checked={onlyAccessible}
                onChange={(changeEvent) =>
                  setOnlyAccessible(changeEvent.currentTarget.checked)
                }
                type="checkbox"
              />{" "}
              Only accessible and companion seats
            </label>
          </div>
          <table className="data-table">
            <caption className="sr-only">
              Seats in {section.name}. Selecting a seat does not reserve it.
            </caption>
            <thead>
              <tr>
                <th scope="col">Select</th>
                <th scope="col">Seat</th>
                <th scope="col">Features</th>
                <th scope="col">Price</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredSeats.map((seat) => (
                <tr key={seat.id}>
                  <td>
                    <input
                      aria-label={`Select ${seatName(seat)} in ${section.name}`}
                      checked={selectedSeats.has(seat.id)}
                      disabled={!salesOpen || seat.status !== "available"}
                      onChange={() => onToggle(section.name, seat)}
                      type="checkbox"
                    />
                  </td>
                  <th scope="row">{seatName(seat)}</th>
                  <td>{seatFeatures(seat)}</td>
                  <td>{formatMoney(seat.priceMinor, currency)}</td>
                  <td>
                    {seat.status === "available" ? "Available" : "Unavailable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredSeats.length === 0 && (
            <p className="form-status" role="status">
              No seats match these filters.
            </p>
          )}
        </>
      )}
      <p className="seat-legend">
        Selected seats show a solid marker. Unavailable seats are crossed out.
        Seats marked A are accessible; dashed seats are companion seats.
      </p>
    </section>
  );
}

function SeatMap({
  currency,
  onToggle,
  salesOpen,
  section,
  selectedSeats,
}: Readonly<{
  currency: string;
  onToggle: (sectionName: string, seat: PublicSeat) => void;
  salesOpen: boolean;
  section: PublicSeatSection;
  selectedSeats: ReadonlyMap<string, SelectedSeat>;
}>): ReactNode {
  const seats = [...section.seats].sort((a, b) => a.y - b.y || a.x - b.x);
  const [focusIndex, setFocusIndex] = useState(0);
  const seatRefs = useRef(new Map<string, SVGGElement>());

  const width = (Math.max(...seats.map((seat) => seat.x)) + 1) * SEAT_PITCH;
  const height = (Math.max(...seats.map((seat) => seat.y)) + 1) * SEAT_PITCH;

  function moveFocus(fromIndex: number, key: string): number | null {
    const current = seats[fromIndex];
    if (!current) {
      return null;
    }
    if (key === "ArrowLeft") {
      return fromIndex > 0 ? fromIndex - 1 : null;
    }
    if (key === "ArrowRight") {
      return fromIndex < seats.length - 1 ? fromIndex + 1 : null;
    }
    const rows = [...new Set(seats.map((seat) => seat.y))].sort(
      (a, b) => a - b
    );
    const rowPosition = rows.indexOf(current.y);
    const targetRow =
      key === "ArrowUp" ? rows[rowPosition - 1] : rows[rowPosition + 1];
    if (targetRow === undefined) {
      return null;
    }
    let best: number | null = null;
    for (const [index, seat] of seats.entries()) {
      if (seat.y !== targetRow) {
        continue;
      }
      if (
        best === null ||
        Math.abs(seat.x - current.x) < Math.abs(seats[best]!.x - current.x)
      ) {
        best = index;
      }
    }
    return best;
  }

  function handleKeyDown(
    keyEvent: KeyboardEvent<SVGGElement>,
    index: number,
    seat: PublicSeat
  ): void {
    if (keyEvent.key === " " || keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      onToggle(section.name, seat);
      return;
    }
    const target = moveFocus(index, keyEvent.key);
    if (target !== null) {
      keyEvent.preventDefault();
      setFocusIndex(target);
      const targetSeat = seats[target];
      if (targetSeat) {
        seatRefs.current.get(targetSeat.id)?.focus();
      }
    }
  }

  return (
    <div className="seat-map-scroll">
      <svg
        aria-label={`${section.name} seat map. Use the arrow keys to move between seats and press Enter to select one.`}
        className="seat-map"
        role="group"
        style={{ minWidth: width / 2 }}
        viewBox={`0 0 ${width} ${height}`}
      >
        {seats.map((seat, index) => {
          const selected = selectedSeats.has(seat.id);
          const unavailable = seat.status !== "available";
          const label = [
            `${seatName(seat)}, ${section.name}`,
            formatMoney(seat.priceMinor, currency),
            seat.accessible ? "accessible" : null,
            seat.companion ? "companion seat" : null,
            unavailable ? "unavailable" : "available",
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <g
              aria-checked={selected}
              aria-disabled={unavailable || !salesOpen}
              aria-label={label}
              className="seat-node"
              data-accessible={seat.accessible || undefined}
              data-companion={seat.companion || undefined}
              data-selected={selected || undefined}
              data-status={seat.status}
              key={seat.id}
              onClick={() => onToggle(section.name, seat)}
              onKeyDown={(keyEvent) => handleKeyDown(keyEvent, index, seat)}
              ref={(node) => {
                if (node) {
                  seatRefs.current.set(seat.id, node);
                } else {
                  seatRefs.current.delete(seat.id);
                }
              }}
              role="checkbox"
              tabIndex={index === focusIndex ? 0 : -1}
              transform={`translate(${seat.x * SEAT_PITCH}, ${seat.y * SEAT_PITCH})`}
            >
              <rect
                className="seat-node__box"
                height={SEAT_CELL}
                rx={8}
                width={SEAT_CELL}
              />
              {unavailable && (
                <>
                  <line
                    className="seat-node__cross"
                    x1={10}
                    x2={SEAT_CELL - 10}
                    y1={10}
                    y2={SEAT_CELL - 10}
                  />
                  <line
                    className="seat-node__cross"
                    x1={SEAT_CELL - 10}
                    x2={10}
                    y1={10}
                    y2={SEAT_CELL - 10}
                  />
                </>
              )}
              <text
                className="seat-node__label"
                textAnchor="middle"
                x={SEAT_CELL / 2}
                y={SEAT_CELL / 2 + 5}
              >
                {seat.rowLabel}
                {seat.seatLabel}
              </text>
              {seat.accessible && (
                <text className="seat-node__marker" x={SEAT_CELL - 12} y={12}>
                  A
                </text>
              )}
              {selected && (
                <rect
                  className="seat-node__selected-ring"
                  height={SEAT_CELL + 8}
                  rx={11}
                  width={SEAT_CELL + 8}
                  x={-4}
                  y={-4}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SelectionSummary({
  busy,
  checkoutError,
  currency,
  gaQuantities,
  generalAdmission,
  onCheckout,
  salesOpen,
  selectedSeats,
  signedIn,
}: Readonly<{
  busy: boolean;
  checkoutError: string | null;
  currency: string;
  gaQuantities: ReadonlyMap<string, number>;
  generalAdmission: EventAvailabilityResponse["generalAdmission"];
  onCheckout: () => void;
  salesOpen: boolean;
  selectedSeats: ReadonlyMap<string, SelectedSeat>;
  signedIn: boolean;
}>): ReactNode {
  const seatLines = [...selectedSeats.values()];
  const gaLines = generalAdmission
    .map((ticketType) => ({
      quantity: gaQuantities.get(ticketType.ticketTypeId) ?? 0,
      ticketType,
    }))
    .filter((line) => line.quantity > 0);

  const subtotalMinor =
    seatLines.reduce((sum, seat) => sum + seat.priceMinor, 0) +
    gaLines.reduce(
      (sum, line) => sum + line.quantity * line.ticketType.priceMinor,
      0
    );
  const unitCount =
    seatLines.length + gaLines.reduce((sum, line) => sum + line.quantity, 0);
  const mixed = seatLines.length > 0 && gaLines.length > 0;

  return (
    <aside aria-labelledby="selection-heading" className="selection-summary">
      <h3 id="selection-heading">Your selection</h3>
      <div aria-live="polite">
        {unitCount === 0 ? (
          <p className="form-status">
            Nothing selected yet. Pick seats or admission above.
          </p>
        ) : (
          <>
            <ul className="selection-summary__lines">
              {seatLines.map((seat) => (
                <li key={seat.id}>
                  {seat.sectionName} {seatName(seat)}:{" "}
                  {formatMoney(seat.priceMinor, currency)}
                </li>
              ))}
              {gaLines.map((line) => (
                <li key={line.ticketType.ticketTypeId}>
                  {line.ticketType.name} x {line.quantity}:{" "}
                  {formatMoney(
                    line.quantity * line.ticketType.priceMinor,
                    currency
                  )}
                </li>
              ))}
            </ul>
            <p className="selection-summary__total">
              Subtotal: {formatMoney(subtotalMinor, currency)}
            </p>
            <p className="field-hint">Fees are added at checkout.</p>
          </>
        )}
      </div>
      <p className="field-hint">
        A selection is not a reservation. Nothing is held for you until checkout
        confirms it with the server, and availability can change at any moment.
      </p>
      {checkoutError && (
        <p className="form-status form-status--error" role="alert">
          {checkoutError}
        </p>
      )}
      {mixed && (
        <p className="form-status" role="status">
          Seats and general admission check out separately. Keep one kind in
          this selection and buy the other in a second order.
        </p>
      )}
      {signedIn ? (
        <button
          className="button-primary"
          disabled={unitCount === 0 || mixed || busy || !salesOpen}
          onClick={onCheckout}
          type="button"
        >
          {busy ? "Starting checkout\u2026" : "Continue to checkout"}
        </button>
      ) : (
        <>
          <a className="button-primary" href="/login">
            Sign in to check out
          </a>
          <p className="field-hint">
            Checkout needs an account so your order and tickets stay with you.
          </p>
        </>
      )}
    </aside>
  );
}
