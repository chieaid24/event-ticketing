import type { Pool } from "pg";
import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "./outbox.js";
import { withDatabaseTransaction } from "./outbox.js";

export type HoldStatus =
  "active" | "checkout_started" | "consumed" | "expired" | "cancelled";

export const MAX_HOLD_ITEMS = 20;
export const MAX_HOLD_ITEM_QUANTITY = 50;
export const MAX_SEATS_PER_HOLD = 10;
/**
 * How long a checkout-started hold outlives its expiry before the sweep frees
 * its inventory. Covers payment processing and webhook delivery time; a
 * payment that succeeds later still finalizes when every unit is reattachable.
 */
export const CHECKOUT_GRACE_SECONDS = 900;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_GUEST_SESSION_LENGTH = 64;

export interface HoldActor {
  guestSessionId?: string;
  userId?: string;
}

export interface HoldItemInput {
  quantity: number;
  ticketTypeId: string;
}

export interface CreateGeneralAdmissionHoldInput {
  actor: HoldActor;
  eventId: string;
  idempotencyKey: string;
  items: HoldItemInput[];
}

export interface CreateAssignedSeatHoldInput {
  actor: HoldActor;
  eventId: string;
  idempotencyKey: string;
  seatIds: string[];
}

export interface AssignedSeatHoldItem {
  eventSeatId: string;
  rowLabel: string;
  seatLabel: string;
  sectionName: string;
  ticketTypeId: string;
  unitFeeMinor: number;
  unitPriceMinor: number;
}

export interface AssignedSeatHoldRecord {
  createdAt: Date;
  currency: string;
  eventId: string;
  expiresAt: Date;
  feeMinor: number;
  guestSessionId: string | null;
  id: string;
  idempotencyKey: string;
  /** True when an existing hold was returned for a repeated idempotency key. */
  replayed: boolean;
  seats: AssignedSeatHoldItem[];
  status: HoldStatus;
  subtotalMinor: number;
  totalMinor: number;
  userId: string | null;
}

export interface HoldItemRecord {
  quantity: number;
  ticketTypeId: string;
  unitFeeMinor: number;
  unitPriceMinor: number;
}

export interface HoldRecord {
  createdAt: Date;
  eventId: string;
  expiresAt: Date;
  guestSessionId: string | null;
  id: string;
  idempotencyKey: string;
  items: HoldItemRecord[];
  /** True when an existing hold was returned for a repeated idempotency key. */
  replayed: boolean;
  status: HoldStatus;
  userId: string | null;
}

export interface HoldTransition {
  changed: boolean;
  status: HoldStatus;
}

export interface GeneralAdmissionAvailabilityRow extends QueryResultRow {
  available: number;
  capacity: number;
  feeMinor: number;
  id: string;
  name: string;
  priceMinor: number;
  reserved: number;
  sold: number;
}

export class HoldInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldInputError";
  }
}

export class HoldEventNotFoundError extends Error {
  constructor() {
    super("The event does not exist.");
    this.name = "HoldEventNotFoundError";
  }
}

export class HoldCapacityError extends Error {
  readonly unavailableTicketTypeIds: string[];

  constructor(unavailableTicketTypeIds: string[]) {
    super(
      "The requested quantity exceeds available general-admission capacity."
    );
    this.name = "HoldCapacityError";
    this.unavailableTicketTypeIds = unavailableTicketTypeIds;
  }
}

export class SeatsUnavailableError extends Error {
  readonly seatIds: string[];

  constructor(seatIds: string[]) {
    super("One or more requested seats are unavailable.");
    this.name = "SeatsUnavailableError";
    this.seatIds = seatIds;
  }
}

export class HoldNotFoundError extends Error {
  constructor() {
    super("The hold does not exist.");
    this.name = "HoldNotFoundError";
  }
}

export class HoldNotFinalizableError extends Error {
  readonly status: HoldStatus | "expired";

  constructor(status: HoldStatus | "expired") {
    super(`A hold in state ${status} cannot be finalized.`);
    this.name = "HoldNotFinalizableError";
    this.status = status;
  }
}

interface HoldRow extends QueryResultRow {
  createdAt: Date;
  eventId: string;
  expiresAt: Date;
  guestSessionId: string | null;
  id: string;
  idempotencyKey: string;
  status: HoldStatus;
  userId: string | null;
}

interface LockedTicketTypeRow extends QueryResultRow {
  capacity: number | null;
  feeMinor: number;
  id: string;
  kind: "assigned" | "general_admission";
  priceMinor: number;
  reservedQuantity: number;
  soldQuantity: number;
}

const holdColumns = `
  "id",
  "event_id" AS "eventId",
  "user_id" AS "userId",
  "guest_session_id" AS "guestSessionId",
  "idempotency_key" AS "idempotencyKey",
  "status",
  "expires_at" AS "expiresAt",
  "created_at" AS "createdAt"
`;

function resolveActorKey(actor: HoldActor): string {
  const hasUser = typeof actor.userId === "string" && actor.userId.length > 0;
  const hasGuest =
    typeof actor.guestSessionId === "string" && actor.guestSessionId.length > 0;

  if (hasUser === hasGuest) {
    throw new HoldInputError(
      "A hold actor must be exactly one user or one guest session."
    );
  }

  if (hasGuest && actor.guestSessionId!.length > MAX_GUEST_SESSION_LENGTH) {
    throw new HoldInputError("The guest session identifier is too long.");
  }

  return hasUser ? `user:${actor.userId!}` : `guest:${actor.guestSessionId!}`;
}

function normalizeItems(items: HoldItemInput[]): HoldItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HoldInputError("A hold must request at least one ticket type.");
  }

  if (items.length > MAX_HOLD_ITEMS) {
    throw new HoldInputError("A hold requests too many ticket types.");
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (
      typeof item.ticketTypeId !== "string" ||
      item.ticketTypeId.length === 0
    ) {
      throw new HoldInputError("Each hold item needs a ticket type.");
    }

    if (seen.has(item.ticketTypeId)) {
      throw new HoldInputError(
        "A ticket type may appear at most once per hold."
      );
    }
    seen.add(item.ticketTypeId);

    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_HOLD_ITEM_QUANTITY
    ) {
      throw new HoldInputError(
        `Each hold quantity must be an integer between 1 and ${MAX_HOLD_ITEM_QUANTITY}.`
      );
    }
  }

  // Stable ticket-type lock order (sorted ids) prevents deadlocks between a
  // create, an expiry, and a finalize that touch overlapping types.
  return [...items].sort((left, right) =>
    left.ticketTypeId < right.ticketTypeId ? -1 : 1
  );
}

async function loadHoldItems(
  executor: DatabaseExecutor,
  holdId: string
): Promise<HoldItemRecord[]> {
  const result = await executor.query<HoldItemRecord & QueryResultRow>(
    `SELECT
       "ticket_type_id" AS "ticketTypeId",
       "quantity",
       "unit_price_minor" AS "unitPriceMinor",
       "unit_fee_minor" AS "unitFeeMinor"
     FROM "hold_items"
     WHERE "hold_id" = $1
     ORDER BY "ticket_type_id"`,
    [holdId]
  );
  return result.rows;
}

/** Locks the hold's ticket types in a stable order before adjusting counters. */
async function lockHoldTicketTypes(
  executor: DatabaseExecutor,
  holdId: string
): Promise<void> {
  await executor.query(
    `SELECT t."id"
     FROM "ticket_types" t
     JOIN "hold_items" hi ON hi."ticket_type_id" = t."id"
     WHERE hi."hold_id" = $1
     ORDER BY t."id"
     FOR UPDATE OF t`,
    [holdId]
  );
}

/** Returns only general-admission reserved quantity; assigned lines hold no counter. */
async function decrementGeneralAdmissionReserved(
  executor: DatabaseExecutor,
  holdId: string
): Promise<void> {
  await executor.query(
    `UPDATE "ticket_types" t
     SET "reserved_quantity" = t."reserved_quantity" - hi."quantity"
     FROM "hold_items" hi
     WHERE hi."hold_id" = $1
       AND hi."event_seat_id" IS NULL
       AND t."id" = hi."ticket_type_id"`,
    [holdId]
  );
}

/**
 * Frees every seat still held by this hold. Seats are locked in id order first
 * so this cannot deadlock with a concurrent create that locks its seats the same
 * way; a seat already reclaimed by a newer hold carries a different hold id and
 * is left untouched.
 */
async function releaseHeldSeats(
  executor: DatabaseExecutor,
  holdId: string
): Promise<void> {
  await executor.query(
    `SELECT "id" FROM "event_seats"
     WHERE "hold_id" = $1 AND "status" = 'held'
     ORDER BY "id"
     FOR UPDATE`,
    [holdId]
  );
  await executor.query(
    `UPDATE "event_seats"
     SET "status" = 'available', "hold_id" = NULL
     WHERE "hold_id" = $1 AND "status" = 'held'`,
    [holdId]
  );
}

/**
 * Reserves general-admission quantity under locked ticket-type counters.
 *
 * Must run inside a transaction. Idempotent on `(actor, idempotencyKey)`: a
 * repeated request returns the original hold without reserving twice.
 */
export async function createGeneralAdmissionHold(
  executor: DatabaseExecutor,
  input: CreateGeneralAdmissionHoldInput
): Promise<HoldRecord> {
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.length === 0 ||
    input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new HoldInputError("A hold needs a bounded idempotency key.");
  }

  const actorKey = resolveActorKey(input.actor);
  const items = normalizeItems(input.items);

  const eventExists = await executor.query(
    `SELECT "id" FROM "events" WHERE "id" = $1`,
    [input.eventId]
  );
  if ((eventExists.rowCount ?? 0) === 0) {
    throw new HoldEventNotFoundError();
  }

  // Insert the hold first so the unique (actor, idempotency key) index arbitrates
  // duplicate requests. A conflict means a hold already exists: replay it.
  const inserted = await executor.query<HoldRow>(
    `INSERT INTO "holds"
       ("event_id", "user_id", "guest_session_id", "actor_key",
        "idempotency_key", "expires_at")
     SELECT
       e."id",
       $2,
       $3,
       $4,
       $5,
       CURRENT_TIMESTAMP + make_interval(secs => e."hold_duration_seconds")
     FROM "events" e
     WHERE e."id" = $1
     ON CONFLICT ("actor_key", "idempotency_key") DO NOTHING
     RETURNING ${holdColumns}`,
    [
      input.eventId,
      input.actor.userId ?? null,
      input.actor.guestSessionId ?? null,
      actorKey,
      input.idempotencyKey,
    ]
  );

  const holdRow = inserted.rows[0];
  if (!holdRow) {
    const existing = await executor.query<HoldRow>(
      `SELECT ${holdColumns} FROM "holds"
       WHERE "actor_key" = $1 AND "idempotency_key" = $2`,
      [actorKey, input.idempotencyKey]
    );
    const existingRow = existing.rows[0]!;
    return {
      ...existingRow,
      items: await loadHoldItems(executor, existingRow.id),
      replayed: true,
    };
  }

  const ticketTypeIds = items.map((item) => item.ticketTypeId);
  const locked = await executor.query<LockedTicketTypeRow>(
    `SELECT
       "id",
       "kind",
       "capacity",
       "reserved_quantity" AS "reservedQuantity",
       "sold_quantity" AS "soldQuantity",
       "price_minor" AS "priceMinor",
       "fee_minor" AS "feeMinor"
     FROM "ticket_types"
     WHERE "id" = ANY($1::uuid[]) AND "event_id" = $2
     ORDER BY "id"
     FOR UPDATE`,
    [ticketTypeIds, input.eventId]
  );

  const lockedById = new Map(locked.rows.map((row) => [row.id, row]));
  if (lockedById.size !== items.length) {
    throw new HoldInputError(
      "Every hold item must reference a ticket type of this event."
    );
  }

  const unavailable: string[] = [];
  const itemRecords: HoldItemRecord[] = [];
  for (const item of items) {
    const ticketType = lockedById.get(item.ticketTypeId)!;
    if (ticketType.kind !== "general_admission") {
      throw new HoldInputError(
        "Only general-admission ticket types accept quantity holds."
      );
    }

    const remaining =
      (ticketType.capacity ?? 0) -
      ticketType.reservedQuantity -
      ticketType.soldQuantity;
    if (remaining < item.quantity) {
      unavailable.push(item.ticketTypeId);
      continue;
    }

    itemRecords.push({
      quantity: item.quantity,
      ticketTypeId: item.ticketTypeId,
      unitFeeMinor: ticketType.feeMinor,
      unitPriceMinor: ticketType.priceMinor,
    });
  }

  if (unavailable.length > 0) {
    throw new HoldCapacityError(unavailable);
  }

  const quantities = items.map((item) => item.quantity);
  const unitPrices = itemRecords.map((item) => item.unitPriceMinor);
  const unitFees = itemRecords.map((item) => item.unitFeeMinor);

  await executor.query(
    `INSERT INTO "hold_items"
       ("hold_id", "ticket_type_id", "quantity",
        "unit_price_minor", "unit_fee_minor")
     SELECT $1, * FROM unnest(
       $2::uuid[], $3::int[], $4::int[], $5::int[]
     )`,
    [holdRow.id, ticketTypeIds, quantities, unitPrices, unitFees]
  );

  await executor.query(
    `UPDATE "ticket_types" t
     SET "reserved_quantity" = t."reserved_quantity" + d."qty"
     FROM (
       SELECT unnest($1::uuid[]) AS "id", unnest($2::int[]) AS "qty"
     ) d
     WHERE t."id" = d."id" AND t."event_id" = $3`,
    [ticketTypeIds, quantities, input.eventId]
  );

  return {
    ...holdRow,
    items: itemRecords,
    replayed: false,
  };
}

/**
 * Expires one reserving hold and returns its inventory exactly once. A no-op
 * for a hold that is not active or checkout-started, so retries are safe. The
 * sweep decides when a checkout-started hold is due (expiry plus grace); this
 * function only applies the mechanics.
 */
export async function expireHold(
  executor: DatabaseExecutor,
  holdId: string
): Promise<HoldTransition> {
  const locked = await executor.query<{ status: HoldStatus }>(
    `SELECT "status" FROM "holds" WHERE "id" = $1 FOR UPDATE`,
    [holdId]
  );
  const current = locked.rows[0];
  if (!current) {
    throw new HoldNotFoundError();
  }

  if (current.status !== "active" && current.status !== "checkout_started") {
    return { changed: false, status: current.status };
  }

  await lockHoldTicketTypes(executor, holdId);
  await decrementGeneralAdmissionReserved(executor, holdId);
  await releaseHeldSeats(executor, holdId);
  await executor.query(
    `UPDATE "holds"
     SET "status" = 'expired', "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [holdId]
  );

  return { changed: true, status: "expired" };
}

/**
 * Reconciliation sweep: expires holds past their database expiry, one hold per
 * transaction so contended rows are skipped rather than blocking the batch.
 */
export async function expireDueHolds(
  pool: Pool,
  input: { limit: number } = { limit: 100 }
): Promise<number> {
  let expired = 0;

  while (expired < input.limit) {
    const didExpire = await withDatabaseTransaction(
      pool,
      async (transaction) => {
        // A checkout-started hold keeps its inventory for a payment grace
        // window past expiry; abandoning checkout still frees it eventually.
        const due = await transaction.query<{ id: string }>(
          `SELECT "id" FROM "holds"
         WHERE ("status" = 'active' AND "expires_at" <= CURRENT_TIMESTAMP)
            OR ("status" = 'checkout_started'
                AND "expires_at" + make_interval(secs => $1)
                      <= CURRENT_TIMESTAMP)
         ORDER BY "expires_at", "id"
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
          [CHECKOUT_GRACE_SECONDS]
        );
        const holdId = due.rows[0]?.id;
        if (!holdId) {
          return false;
        }

        await expireHold(transaction, holdId);
        return true;
      }
    );

    if (!didExpire) {
      break;
    }
    expired += 1;
  }

  return expired;
}

/**
 * Finalizes a purchase by moving reserved quantity to sold and consuming the
 * hold. Idempotent for an already-consumed hold; rejects an expired one.
 */
export async function finalizeGeneralAdmissionHold(
  executor: DatabaseExecutor,
  holdId: string
): Promise<HoldTransition> {
  const locked = await executor.query<{
    expired: boolean;
    status: HoldStatus;
  }>(
    `SELECT "status", ("expires_at" <= CURRENT_TIMESTAMP) AS "expired"
     FROM "holds" WHERE "id" = $1 FOR UPDATE`,
    [holdId]
  );
  const current = locked.rows[0];
  if (!current) {
    throw new HoldNotFoundError();
  }

  if (current.status === "consumed") {
    return { changed: false, status: "consumed" };
  }

  if (current.status !== "active" && current.status !== "checkout_started") {
    throw new HoldNotFinalizableError(current.status);
  }

  if (current.expired) {
    throw new HoldNotFinalizableError("expired");
  }

  await lockHoldTicketTypes(executor, holdId);
  await executor.query(
    `UPDATE "ticket_types" t
     SET "reserved_quantity" = t."reserved_quantity" - hi."quantity",
         "sold_quantity" = t."sold_quantity" + hi."quantity"
     FROM "hold_items" hi
     WHERE hi."hold_id" = $1
       AND hi."event_seat_id" IS NULL
       AND t."id" = hi."ticket_type_id"`,
    [holdId]
  );
  await executor.query(
    `UPDATE "holds"
     SET "status" = 'consumed', "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [holdId]
  );

  return { changed: true, status: "consumed" };
}

/**
 * Cancels an actor's own active hold and returns its reserved quantity.
 * Idempotent for an already-cancelled hold.
 */
export async function cancelHold(
  executor: DatabaseExecutor,
  input: { actor: HoldActor; holdId: string }
): Promise<HoldTransition> {
  const actorKey = resolveActorKey(input.actor);
  const locked = await executor.query<{ actorKey: string; status: HoldStatus }>(
    `SELECT "status", "actor_key" AS "actorKey"
     FROM "holds" WHERE "id" = $1 FOR UPDATE`,
    [input.holdId]
  );
  const current = locked.rows[0];
  // An actor may only see and cancel its own hold.
  if (!current || current.actorKey !== actorKey) {
    throw new HoldNotFoundError();
  }

  if (current.status === "cancelled") {
    return { changed: false, status: "cancelled" };
  }

  if (current.status !== "active" && current.status !== "checkout_started") {
    throw new HoldNotFinalizableError(current.status);
  }

  await lockHoldTicketTypes(executor, input.holdId);
  await decrementGeneralAdmissionReserved(executor, input.holdId);
  await releaseHeldSeats(executor, input.holdId);
  await executor.query(
    `UPDATE "holds"
     SET "status" = 'cancelled', "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [input.holdId]
  );

  return { changed: true, status: "cancelled" };
}

interface LockedSeatRow extends QueryResultRow {
  eventId: string;
  feeMinor: number;
  id: string;
  isAvailable: boolean;
  isReclaimable: boolean;
  priceMinor: number;
  rowLabel: string;
  seatLabel: string;
  sectionName: string;
  ticketTypeId: string;
  ticketTypeKind: "assigned" | "general_admission";
}

function normalizeSeatIds(seatIds: string[]): string[] {
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    throw new HoldInputError("A seat hold must request at least one seat.");
  }

  if (seatIds.length > MAX_SEATS_PER_HOLD) {
    throw new HoldInputError(
      `A seat hold may request at most ${MAX_SEATS_PER_HOLD} seats.`
    );
  }

  const seen = new Set<string>();
  for (const seatId of seatIds) {
    if (typeof seatId !== "string" || seatId.length === 0) {
      throw new HoldInputError("Each requested seat needs an identifier.");
    }
    if (seen.has(seatId)) {
      throw new HoldInputError("A seat may appear at most once per hold.");
    }
    seen.add(seatId);
  }

  // Stable seat lock order (sorted ids) prevents deadlocks between a create, an
  // expiry, and a cancel that touch overlapping seats.
  return [...seatIds].sort((left, right) => (left < right ? -1 : 1));
}

async function loadAssignedSeatItems(
  executor: DatabaseExecutor,
  holdId: string
): Promise<AssignedSeatHoldItem[]> {
  const result = await executor.query<AssignedSeatHoldItem & QueryResultRow>(
    `SELECT
       hi."event_seat_id" AS "eventSeatId",
       hi."ticket_type_id" AS "ticketTypeId",
       hi."unit_price_minor" AS "unitPriceMinor",
       hi."unit_fee_minor" AS "unitFeeMinor",
       s."section_name" AS "sectionName",
       s."row_label" AS "rowLabel",
       s."seat_label" AS "seatLabel"
     FROM "hold_items" hi
     JOIN "event_seats" s ON s."id" = hi."event_seat_id"
     WHERE hi."hold_id" = $1 AND hi."event_seat_id" IS NOT NULL
     ORDER BY hi."event_seat_id"`,
    [holdId]
  );
  return result.rows;
}

function summarizeSeats(seats: AssignedSeatHoldItem[]): {
  feeMinor: number;
  subtotalMinor: number;
  totalMinor: number;
} {
  let subtotalMinor = 0;
  let feeMinor = 0;
  for (const seat of seats) {
    subtotalMinor += seat.unitPriceMinor;
    feeMinor += seat.unitFeeMinor;
  }
  return { feeMinor, subtotalMinor, totalMinor: subtotalMinor + feeMinor };
}

/**
 * Reserves specific assigned seats under per-seat row locks. Must run inside a
 * transaction. Idempotent on `(actor, idempotencyKey)`: a repeated request
 * returns the original hold without holding a seat twice. Server-priced from the
 * locked seat rows; the browser never supplies a price. Either all requested
 * seats are held or none are, and only unavailable seat ids are disclosed.
 */
export async function createAssignedSeatHold(
  executor: DatabaseExecutor,
  input: CreateAssignedSeatHoldInput
): Promise<AssignedSeatHoldRecord> {
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.length === 0 ||
    input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    throw new HoldInputError("A hold needs a bounded idempotency key.");
  }

  const actorKey = resolveActorKey(input.actor);
  const seatIds = normalizeSeatIds(input.seatIds);

  const event = await executor.query<{ currency: string } & QueryResultRow>(
    `SELECT "currency" FROM "events" WHERE "id" = $1`,
    [input.eventId]
  );
  const currency = event.rows[0]?.currency;
  if (currency === undefined) {
    throw new HoldEventNotFoundError();
  }

  // Insert the hold first so the unique (actor, idempotency key) index arbitrates
  // duplicate requests. A conflict means a hold already exists: replay it.
  const inserted = await executor.query<HoldRow>(
    `INSERT INTO "holds"
       ("event_id", "user_id", "guest_session_id", "actor_key",
        "idempotency_key", "expires_at")
     SELECT
       e."id",
       $2,
       $3,
       $4,
       $5,
       CURRENT_TIMESTAMP + make_interval(secs => e."hold_duration_seconds")
     FROM "events" e
     WHERE e."id" = $1
     ON CONFLICT ("actor_key", "idempotency_key") DO NOTHING
     RETURNING ${holdColumns}`,
    [
      input.eventId,
      input.actor.userId ?? null,
      input.actor.guestSessionId ?? null,
      actorKey,
      input.idempotencyKey,
    ]
  );

  const holdRow = inserted.rows[0];
  if (!holdRow) {
    const existing = await executor.query<HoldRow>(
      `SELECT ${holdColumns} FROM "holds"
       WHERE "actor_key" = $1 AND "idempotency_key" = $2`,
      [actorKey, input.idempotencyKey]
    );
    const existingRow = existing.rows[0]!;
    const seats = await loadAssignedSeatItems(executor, existingRow.id);
    return {
      ...existingRow,
      currency,
      ...summarizeSeats(seats),
      seats,
      replayed: true,
    };
  }

  // Lock the requested seats in id order. Expiry uses database time so a missed
  // sweep never grants rights: a held-but-expired seat is reclaimable, a held
  // seat whose hold has not expired belongs to a live reservation.
  const locked = await executor.query<LockedSeatRow>(
    `SELECT
       s."id",
       s."event_id" AS "eventId",
       s."ticket_type_id" AS "ticketTypeId",
       s."price_minor" AS "priceMinor",
       s."section_name" AS "sectionName",
       s."row_label" AS "rowLabel",
       s."seat_label" AS "seatLabel",
       t."kind" AS "ticketTypeKind",
       t."fee_minor" AS "feeMinor",
       (s."status" = 'available') AS "isAvailable",
       (s."status" = 'held' AND h."expires_at" <= CURRENT_TIMESTAMP)
         AS "isReclaimable"
     FROM "event_seats" s
     JOIN "ticket_types" t ON t."id" = s."ticket_type_id"
     LEFT JOIN "holds" h ON h."id" = s."hold_id"
     WHERE s."id" = ANY($1::uuid[])
     ORDER BY s."id"
     FOR UPDATE OF s`,
    [seatIds]
  );

  const lockedById = new Map(locked.rows.map((row) => [row.id, row]));
  const unavailable: string[] = [];
  const takeable: LockedSeatRow[] = [];
  for (const seatId of seatIds) {
    const seat = lockedById.get(seatId);
    const usable =
      seat !== undefined &&
      seat.eventId === input.eventId &&
      seat.ticketTypeKind === "assigned" &&
      (seat.isAvailable || seat.isReclaimable);
    if (!usable) {
      unavailable.push(seatId);
      continue;
    }
    takeable.push(seat);
  }

  if (unavailable.length > 0) {
    throw new SeatsUnavailableError(unavailable);
  }

  const seatOrder = takeable.map((seat) => seat.id);
  const ticketTypeIds = takeable.map((seat) => seat.ticketTypeId);
  const unitPrices = takeable.map((seat) => seat.priceMinor);
  const unitFees = takeable.map((seat) => seat.feeMinor);
  const quantities = takeable.map(() => 1);

  await executor.query(
    `INSERT INTO "hold_items"
       ("hold_id", "ticket_type_id", "event_seat_id", "quantity",
        "unit_price_minor", "unit_fee_minor")
     SELECT $1, * FROM unnest(
       $2::uuid[], $3::uuid[], $4::int[], $5::int[], $6::int[]
     )`,
    [holdRow.id, ticketTypeIds, seatOrder, quantities, unitPrices, unitFees]
  );

  const updated = await executor.query(
    `UPDATE "event_seats"
     SET "status" = 'held', "hold_id" = $2
     WHERE "id" = ANY($1::uuid[])`,
    [seatOrder, holdRow.id]
  );
  // The seats were validated under lock, so every requested row must flip.
  if ((updated.rowCount ?? 0) !== seatOrder.length) {
    throw new SeatsUnavailableError(seatIds);
  }

  const seats: AssignedSeatHoldItem[] = takeable.map((seat) => ({
    eventSeatId: seat.id,
    rowLabel: seat.rowLabel,
    seatLabel: seat.seatLabel,
    sectionName: seat.sectionName,
    ticketTypeId: seat.ticketTypeId,
    unitFeeMinor: seat.feeMinor,
    unitPriceMinor: seat.priceMinor,
  }));

  return {
    ...holdRow,
    currency,
    ...summarizeSeats(seats),
    seats,
    replayed: false,
  };
}

/** Remaining general-admission quantity per ticket type for an event. */
export async function fetchGeneralAdmissionAvailability(
  executor: DatabaseExecutor,
  eventId: string
): Promise<GeneralAdmissionAvailabilityRow[]> {
  const result = await executor.query<GeneralAdmissionAvailabilityRow>(
    `SELECT
       "id",
       "name",
       "price_minor" AS "priceMinor",
       "fee_minor" AS "feeMinor",
       COALESCE("capacity", 0)::int AS "capacity",
       "reserved_quantity" AS "reserved",
       "sold_quantity" AS "sold",
       (COALESCE("capacity", 0) - "reserved_quantity" - "sold_quantity")::int
         AS "available"
     FROM "ticket_types"
     WHERE "event_id" = $1 AND "kind" = 'general_admission'
     ORDER BY "position", "name"`,
    [eventId]
  );
  return result.rows;
}
