import { randomBytes } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "./outbox.js";
import type { HoldStatus } from "./holds.js";

export type OrderStatus =
  "pending_payment" | "paid" | "payment_conflict" | "refunded";

export type PaymentStatus =
  "requires_payment" | "succeeded" | "refund_pending" | "refunded";

export interface OrderActor {
  guestSessionId?: string;
  userId?: string;
}

export interface CreateOrderForHoldInput {
  actor: OrderActor;
  holdId: string;
  provider: string;
}

export interface OrderItemRecord {
  eventSeatId: string | null;
  quantity: number;
  rowLabel: string | null;
  seatLabel: string | null;
  sectionName: string | null;
  ticketTypeId: string;
  ticketTypeName: string;
  unitFeeMinor: number;
  unitPriceMinor: number;
}

export interface OrderPaymentRecord {
  amountMinor: number;
  clientSecret: string | null;
  currency: string;
  lastFailureAt: Date | null;
  lastFailureCode: string | null;
  provider: string;
  providerPaymentIntentId: string | null;
  status: PaymentStatus;
}

export interface OrderRecord {
  createdAt: Date;
  currency: string;
  eventId: string;
  eventTitle: string;
  feeMinor: number;
  holdExpiresAt: Date;
  holdId: string;
  id: string;
  items: OrderItemRecord[];
  paidAt: Date | null;
  payment: OrderPaymentRecord;
  publicNumber: string;
  /** True when an existing order was returned for a repeated checkout. */
  replayed: boolean;
  status: OrderStatus;
  subtotalMinor: number;
  ticketCount: number;
  totalMinor: number;
}

export type FinalizePaymentOutcome =
  /** Inventory secured, order paid, tickets issued. */
  | { outcome: "paid"; orderId: string; ticketCount: number }
  /** Payment captured but inventory lost; compensation must follow. */
  | { outcome: "conflict"; orderId: string }
  /** A duplicate delivery of an already-applied transition. */
  | { outcome: "already_final"; orderId: string; status: OrderStatus };

export class OrderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderInputError";
  }
}

export class OrderHoldNotFoundError extends Error {
  constructor() {
    super("The hold does not exist.");
    this.name = "OrderHoldNotFoundError";
  }
}

export class HoldNotCheckoutableError extends Error {
  readonly status: HoldStatus | "expired";

  constructor(status: HoldStatus | "expired") {
    super(`A hold in state ${status} cannot start checkout.`);
    this.name = "HoldNotCheckoutableError";
    this.status = status;
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("The order does not exist.");
    this.name = "OrderNotFoundError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super("No payment matches the provider reference.");
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentVerificationError";
  }
}

export class OrderStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderStateError";
  }
}

function resolveActorKey(actor: OrderActor): string {
  const hasUser = typeof actor.userId === "string" && actor.userId.length > 0;
  const hasGuest =
    typeof actor.guestSessionId === "string" && actor.guestSessionId.length > 0;

  if (hasUser === hasGuest) {
    throw new OrderInputError(
      "An order actor must be exactly one user or one guest session."
    );
  }

  return hasUser ? `user:${actor.userId!}` : `guest:${actor.guestSessionId!}`;
}

// Crockford-style alphabet without ambiguous glyphs; 12 chars of 31 symbols
// leaves collisions negligible, and the unique index rejects the exception.
const PUBLIC_NUMBER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateOrderPublicNumber(): string {
  const bytes = randomBytes(12);
  let out = "ET-";
  for (const byte of bytes) {
    out += PUBLIC_NUMBER_ALPHABET[byte % 32];
  }
  return out;
}

interface OrderRow extends QueryResultRow {
  actorKey: string;
  createdAt: Date;
  currency: string;
  eventId: string;
  feeMinor: number;
  holdId: string;
  id: string;
  paidAt: Date | null;
  publicNumber: string;
  status: OrderStatus;
  subtotalMinor: number;
  totalMinor: number;
}

const orderColumns = `
  "id",
  "public_number" AS "publicNumber",
  "hold_id" AS "holdId",
  "event_id" AS "eventId",
  "actor_key" AS "actorKey",
  "status",
  "currency",
  "subtotal_minor" AS "subtotalMinor",
  "fee_minor" AS "feeMinor",
  "total_minor" AS "totalMinor",
  "paid_at" AS "paidAt",
  "created_at" AS "createdAt"
`;

async function loadOrderItems(
  executor: DatabaseExecutor,
  orderId: string
): Promise<OrderItemRecord[]> {
  const result = await executor.query<OrderItemRecord & QueryResultRow>(
    `SELECT
       oi."ticket_type_id" AS "ticketTypeId",
       t."name" AS "ticketTypeName",
       oi."event_seat_id" AS "eventSeatId",
       oi."quantity",
       oi."unit_price_minor" AS "unitPriceMinor",
       oi."unit_fee_minor" AS "unitFeeMinor",
       s."section_name" AS "sectionName",
       s."row_label" AS "rowLabel",
       s."seat_label" AS "seatLabel"
     FROM "order_items" oi
     JOIN "ticket_types" t ON t."id" = oi."ticket_type_id"
     LEFT JOIN "event_seats" s ON s."id" = oi."event_seat_id"
     WHERE oi."order_id" = $1
     ORDER BY t."name", oi."event_seat_id"`,
    [orderId]
  );
  return result.rows;
}

interface OrderContextRow extends QueryResultRow {
  eventTitle: string;
  holdExpiresAt: Date;
  ticketCount: number;
}

async function loadOrderContext(
  executor: DatabaseExecutor,
  orderId: string
): Promise<OrderContextRow> {
  const result = await executor.query<OrderContextRow>(
    `SELECT
       e."title" AS "eventTitle",
       h."expires_at" AS "holdExpiresAt",
       (SELECT COUNT(*)::int FROM "tickets" tk
        WHERE tk."order_id" = o."id" AND tk."status" = 'active')
         AS "ticketCount"
     FROM "orders" o
     JOIN "events" e ON e."id" = o."event_id"
     JOIN "holds" h ON h."id" = o."hold_id"
     WHERE o."id" = $1`,
    [orderId]
  );
  return result.rows[0]!;
}

interface PaymentRow extends QueryResultRow {
  amountMinor: number;
  clientSecret: string | null;
  currency: string;
  lastFailureAt: Date | null;
  lastFailureCode: string | null;
  provider: string;
  providerPaymentIntentId: string | null;
  status: PaymentStatus;
}

async function loadPayment(
  executor: DatabaseExecutor,
  orderId: string
): Promise<PaymentRow> {
  const result = await executor.query<PaymentRow>(
    `SELECT
       "provider",
       "provider_payment_intent_id" AS "providerPaymentIntentId",
       "client_secret" AS "clientSecret",
       "amount_minor" AS "amountMinor",
       "currency",
       "status",
       "last_failure_code" AS "lastFailureCode",
       "last_failure_at" AS "lastFailureAt"
     FROM "payments" WHERE "order_id" = $1`,
    [orderId]
  );
  return result.rows[0]!;
}

async function assembleOrderRecord(
  executor: DatabaseExecutor,
  row: OrderRow,
  replayed: boolean
): Promise<OrderRecord> {
  const [items, payment, context] = [
    await loadOrderItems(executor, row.id),
    await loadPayment(executor, row.id),
    await loadOrderContext(executor, row.id),
  ];
  return {
    createdAt: row.createdAt,
    currency: row.currency,
    eventId: row.eventId,
    eventTitle: context.eventTitle,
    feeMinor: row.feeMinor,
    holdExpiresAt: context.holdExpiresAt,
    holdId: row.holdId,
    id: row.id,
    items,
    paidAt: row.paidAt,
    payment,
    publicNumber: row.publicNumber,
    replayed,
    status: row.status,
    subtotalMinor: row.subtotalMinor,
    ticketCount: context.ticketCount,
    totalMinor: row.totalMinor,
  };
}

/**
 * Creates or replays the one order for an actor-owned hold. Must run inside a
 * transaction. The unique orders.hold_id index arbitrates duplicate checkouts:
 * the loser of a race replays the winner's order. Money is recalculated from
 * the hold's server-priced items; nothing commercial comes from the caller.
 */
export async function createOrderForHold(
  executor: DatabaseExecutor,
  input: CreateOrderForHoldInput
): Promise<OrderRecord> {
  const actorKey = resolveActorKey(input.actor);

  const holdResult = await executor.query<
    {
      eventId: string;
      expired: boolean;
      guestSessionId: string | null;
      status: HoldStatus;
      userId: string | null;
    } & QueryResultRow
  >(
    `SELECT
       h."event_id" AS "eventId",
       h."user_id" AS "userId",
       h."guest_session_id" AS "guestSessionId",
       h."status",
       (h."expires_at" <= CURRENT_TIMESTAMP) AS "expired"
     FROM "holds" h
     WHERE h."id" = $1 AND h."actor_key" = $2
     FOR UPDATE`,
    [input.holdId, actorKey]
  );
  const hold = holdResult.rows[0];
  // An actor may only see and check out its own hold.
  if (!hold) {
    throw new OrderHoldNotFoundError();
  }

  const existing = await executor.query<OrderRow>(
    `SELECT ${orderColumns} FROM "orders" WHERE "hold_id" = $1`,
    [input.holdId]
  );
  if (existing.rows[0]) {
    return assembleOrderRecord(executor, existing.rows[0], true);
  }

  if (hold.status !== "active" && hold.status !== "checkout_started") {
    throw new HoldNotCheckoutableError(hold.status);
  }
  if (hold.expired) {
    throw new HoldNotCheckoutableError("expired");
  }

  const totals = await executor.query<
    {
      currency: string;
      feeMinor: number;
      itemCount: number;
      subtotalMinor: number;
    } & QueryResultRow
  >(
    `SELECT
       e."currency",
       COUNT(hi."id")::int AS "itemCount",
       COALESCE(SUM(hi."quantity" * hi."unit_price_minor"), 0)::int
         AS "subtotalMinor",
       COALESCE(SUM(hi."quantity" * hi."unit_fee_minor"), 0)::int
         AS "feeMinor"
     FROM "events" e
     LEFT JOIN "hold_items" hi ON hi."hold_id" = $1
     WHERE e."id" = $2
     GROUP BY e."currency"`,
    [input.holdId, hold.eventId]
  );
  const priced = totals.rows[0];
  if (!priced || priced.itemCount === 0) {
    throw new OrderStateError("The hold has no priced items.");
  }

  const inserted = await executor.query<OrderRow>(
    `INSERT INTO "orders"
       ("public_number", "hold_id", "event_id", "user_id", "guest_session_id",
        "actor_key", "currency", "subtotal_minor", "fee_minor", "total_minor")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT ("hold_id") DO NOTHING
     RETURNING ${orderColumns}`,
    [
      generateOrderPublicNumber(),
      input.holdId,
      hold.eventId,
      hold.userId,
      hold.guestSessionId,
      actorKey,
      priced.currency,
      priced.subtotalMinor,
      priced.feeMinor,
      priced.subtotalMinor + priced.feeMinor,
    ]
  );
  const orderRow = inserted.rows[0];
  // The hold row lock serializes checkouts for one hold, so a lost insert can
  // only mean a competing transaction already committed this order.
  if (!orderRow) {
    const replay = await executor.query<OrderRow>(
      `SELECT ${orderColumns} FROM "orders" WHERE "hold_id" = $1`,
      [input.holdId]
    );
    return assembleOrderRecord(executor, replay.rows[0]!, true);
  }

  await executor.query(
    `INSERT INTO "order_items"
       ("order_id", "ticket_type_id", "event_seat_id", "quantity",
        "unit_price_minor", "unit_fee_minor")
     SELECT $1, hi."ticket_type_id", hi."event_seat_id", hi."quantity",
            hi."unit_price_minor", hi."unit_fee_minor"
     FROM "hold_items" hi
     WHERE hi."hold_id" = $2`,
    [orderRow.id, input.holdId]
  );

  await executor.query(
    `INSERT INTO "payments" ("order_id", "provider", "amount_minor", "currency")
     VALUES ($1, $2, $3, $4)`,
    [orderRow.id, input.provider, orderRow.totalMinor, orderRow.currency]
  );

  await executor.query(
    `UPDATE "holds"
     SET "status" = 'checkout_started', "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" = 'active'`,
    [input.holdId]
  );

  return assembleOrderRecord(executor, orderRow, false);
}

/**
 * Records the provider references created after the checkout transaction
 * committed. Idempotent for the same intent; a different intent for an order
 * that already has one is an invariant violation, never silently replaced.
 */
export async function attachPaymentIntent(
  executor: DatabaseExecutor,
  input: {
    clientSecret: string;
    orderId: string;
    providerPaymentIntentId: string;
  }
): Promise<void> {
  const updated = await executor.query(
    `UPDATE "payments"
     SET "provider_payment_intent_id" = $2,
         "client_secret" = $3,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "order_id" = $1
       AND ("provider_payment_intent_id" IS NULL
            OR "provider_payment_intent_id" = $2)`,
    [input.orderId, input.providerPaymentIntentId, input.clientSecret]
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw new OrderStateError(
      "The order's payment already references a different payment intent."
    );
  }
}

/** Loads one actor-scoped order; the actor never sees another actor's order. */
export async function loadOrderForActor(
  executor: DatabaseExecutor,
  input: { actor: OrderActor; orderId: string }
): Promise<OrderRecord> {
  const actorKey = resolveActorKey(input.actor);
  const result = await executor.query<OrderRow>(
    `SELECT ${orderColumns} FROM "orders"
     WHERE "id" = $1 AND "actor_key" = $2`,
    [input.orderId, actorKey]
  );
  const row = result.rows[0];
  if (!row) {
    throw new OrderNotFoundError();
  }
  return assembleOrderRecord(executor, row, false);
}

export interface RecordWebhookEventInput {
  payload: unknown;
  provider: string;
  providerEventId: string;
  type: string;
}

export interface WebhookEventRecord {
  id: string;
  /** True when this delivery duplicated an already-recorded event. */
  replayed: boolean;
}

/**
 * Durably records one verified provider event before any processing. The
 * (provider, event id) unique index makes duplicate deliveries replay the
 * original row instead of recording twice.
 */
export async function recordWebhookEvent(
  executor: DatabaseExecutor,
  input: RecordWebhookEventInput
): Promise<WebhookEventRecord> {
  const inserted = await executor.query<{ id: string } & QueryResultRow>(
    `INSERT INTO "webhook_events"
       ("provider", "provider_event_id", "type", "payload")
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT ("provider", "provider_event_id") DO NOTHING
     RETURNING "id"`,
    [
      input.provider,
      input.providerEventId,
      input.type,
      JSON.stringify(input.payload),
    ]
  );
  const row = inserted.rows[0];
  if (row) {
    return { id: row.id, replayed: false };
  }

  const existing = await executor.query<{ id: string } & QueryResultRow>(
    `SELECT "id" FROM "webhook_events"
     WHERE "provider" = $1 AND "provider_event_id" = $2`,
    [input.provider, input.providerEventId]
  );
  return { id: existing.rows[0]!.id, replayed: true };
}

/** Marks a webhook event processed; repeat calls keep the first timestamp. */
export async function markWebhookEventProcessed(
  executor: DatabaseExecutor,
  webhookEventId: string
): Promise<void> {
  await executor.query(
    `UPDATE "webhook_events"
     SET "processed_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "processed_at" IS NULL`,
    [webhookEventId]
  );
}

interface LockedFinalizeRow extends QueryResultRow {
  amountMinor: number;
  currency: string;
  eventId: string;
  holdId: string;
  orderId: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
}

interface FinalizeItemRow extends QueryResultRow {
  eventSeatId: string | null;
  id: string;
  quantity: number;
  ticketTypeId: string;
}

/**
 * Applies a verified successful payment to its order exactly once.
 *
 * Must run inside a transaction. Locks the order, payment, hold, ticket types,
 * and seats, then either secures every unit and issues tickets, or - when any
 * unit is lost - leaves the order in payment_conflict for compensation. Grace
 * rule: a hold that expired while the customer paid may still finalize when
 * every unit is reattachable (a seat still held by it, reclaimable, or back to
 * available; general admission with remaining capacity). Units are never
 * partially secured and seats are never substituted.
 */
export async function finalizeOrderPayment(
  executor: DatabaseExecutor,
  input: {
    amountMinor: number;
    currency: string;
    providerPaymentIntentId: string;
  }
): Promise<FinalizePaymentOutcome> {
  const locked = await executor.query<LockedFinalizeRow>(
    `SELECT
       p."amount_minor" AS "amountMinor",
       p."currency",
       p."status" AS "paymentStatus",
       o."id" AS "orderId",
       o."status" AS "orderStatus",
       o."hold_id" AS "holdId",
       o."event_id" AS "eventId"
     FROM "payments" p
     JOIN "orders" o ON o."id" = p."order_id"
     WHERE p."provider_payment_intent_id" = $1
     FOR UPDATE OF p, o`,
    [input.providerPaymentIntentId]
  );
  const target = locked.rows[0];
  if (!target) {
    throw new PaymentNotFoundError();
  }

  // The provider never decides commercial value: a mismatch is an invariant
  // violation surfaced for operators, not a state to reconcile automatically.
  if (
    input.amountMinor !== target.amountMinor ||
    input.currency.toUpperCase() !== target.currency.toUpperCase()
  ) {
    throw new PaymentVerificationError(
      "The provider amount or currency does not match the order."
    );
  }

  if (target.orderStatus !== "pending_payment") {
    return {
      outcome: "already_final",
      orderId: target.orderId,
      status: target.orderStatus,
    };
  }

  const holdResult = await executor.query<
    { status: HoldStatus } & QueryResultRow
  >(`SELECT "status" FROM "holds" WHERE "id" = $1 FOR UPDATE`, [target.holdId]);
  const holdStatus = holdResult.rows[0]!.status;

  const items = await executor.query<FinalizeItemRow>(
    `SELECT
       oi."id",
       oi."ticket_type_id" AS "ticketTypeId",
       oi."event_seat_id" AS "eventSeatId",
       oi."quantity"
     FROM "order_items" oi
     WHERE oi."order_id" = $1
     ORDER BY oi."ticket_type_id"`,
    [target.orderId]
  );

  // Stable ticket-type lock order (sorted ids) matches every hold flow.
  const lockedTypes = await executor.query<
    {
      capacity: number | null;
      id: string;
      kind: "assigned" | "general_admission";
      reservedQuantity: number;
      soldQuantity: number;
    } & QueryResultRow
  >(
    `SELECT DISTINCT
       t."id",
       t."kind",
       t."capacity",
       t."reserved_quantity" AS "reservedQuantity",
       t."sold_quantity" AS "soldQuantity"
     FROM "ticket_types" t
     JOIN "order_items" oi ON oi."ticket_type_id" = t."id"
     WHERE oi."order_id" = $1
     ORDER BY t."id"
     FOR UPDATE OF t`,
    [target.orderId]
  );
  const typesById = new Map(lockedTypes.rows.map((row) => [row.id, row]));

  const seatIds = items.rows
    .map((item) => item.eventSeatId)
    .filter((id): id is string => id !== null)
    .sort((left, right) => (left < right ? -1 : 1));

  // A seat is securable while this hold still holds it, when it fell back to
  // available, or when a newer hold on it has itself expired by database time.
  const securableSeats = new Set<string>();
  if (seatIds.length > 0) {
    const lockedSeats = await executor.query<
      { id: string; securable: boolean } & QueryResultRow
    >(
      `SELECT
         s."id",
         (
           (s."status" = 'held' AND s."hold_id" = $2)
           OR s."status" = 'available'
           OR (s."status" = 'held'
               AND h."expires_at" <= CURRENT_TIMESTAMP)
         ) AS "securable"
       FROM "event_seats" s
       LEFT JOIN "holds" h ON h."id" = s."hold_id"
       WHERE s."id" = ANY($1::uuid[])
       ORDER BY s."id"
       FOR UPDATE OF s`,
      [seatIds, target.holdId]
    );
    for (const seat of lockedSeats.rows) {
      if (seat.securable) {
        securableSeats.add(seat.id);
      }
    }
  }

  const holdOwnsReservation =
    holdStatus === "active" || holdStatus === "checkout_started";

  let everyUnitSecurable = seatIds.every((id) => securableSeats.has(id));
  const generalAdmissionItems = items.rows.filter(
    (item) => item.eventSeatId === null
  );
  for (const item of generalAdmissionItems) {
    const ticketType = typesById.get(item.ticketTypeId)!;
    if (holdOwnsReservation) {
      continue; // Reserved quantity still covers this line.
    }
    const remaining =
      (ticketType.capacity ?? 0) -
      ticketType.reservedQuantity -
      ticketType.soldQuantity;
    if (remaining < item.quantity) {
      everyUnitSecurable = false;
    }
  }

  if (!everyUnitSecurable) {
    // Free whatever this hold still occupies; the charge is compensated by an
    // idempotent full refund, never by substituting inventory.
    if (holdOwnsReservation) {
      await executor.query(
        `UPDATE "ticket_types" t
         SET "reserved_quantity" = t."reserved_quantity" - hi."quantity"
         FROM "hold_items" hi
         WHERE hi."hold_id" = $1
           AND hi."event_seat_id" IS NULL
           AND t."id" = hi."ticket_type_id"`,
        [target.holdId]
      );
    }
    await executor.query(
      `UPDATE "event_seats"
       SET "status" = 'available', "hold_id" = NULL
       WHERE "hold_id" = $1 AND "status" = 'held'`,
      [target.holdId]
    );
    await executor.query(
      `UPDATE "holds"
       SET "status" = 'cancelled', "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" IN ('active', 'checkout_started')`,
      [target.holdId]
    );
    await executor.query(
      `UPDATE "orders"
       SET "status" = 'payment_conflict', "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [target.orderId]
    );
    await executor.query(
      `UPDATE "payments"
       SET "status" = 'succeeded', "updated_at" = CURRENT_TIMESTAMP
       WHERE "order_id" = $1`,
      [target.orderId]
    );
    return { outcome: "conflict", orderId: target.orderId };
  }

  if (seatIds.length > 0) {
    const soldSeats = await executor.query(
      `UPDATE "event_seats"
       SET "status" = 'sold', "hold_id" = NULL
       WHERE "id" = ANY($1::uuid[])`,
      [seatIds]
    );
    // The seats were validated under lock, so every row must flip.
    if ((soldSeats.rowCount ?? 0) !== seatIds.length) {
      throw new OrderStateError("A validated seat failed to move to sold.");
    }
  }

  for (const item of generalAdmissionItems) {
    if (holdOwnsReservation) {
      await executor.query(
        `UPDATE "ticket_types"
         SET "reserved_quantity" = "reserved_quantity" - $2,
             "sold_quantity" = "sold_quantity" + $2
         WHERE "id" = $1`,
        [item.ticketTypeId, item.quantity]
      );
    } else {
      await executor.query(
        `UPDATE "ticket_types"
         SET "sold_quantity" = "sold_quantity" + $2
         WHERE "id" = $1`,
        [item.ticketTypeId, item.quantity]
      );
    }
  }

  await executor.query(
    `UPDATE "holds"
     SET "status" = 'consumed', "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [target.holdId]
  );

  // One admission credential per purchased unit. The order was still
  // pending_payment under lock, so tickets cannot already exist.
  const insertedTickets = await executor.query(
    `INSERT INTO "tickets"
       ("order_id", "order_item_id", "event_id", "ticket_type_id",
        "event_seat_id")
     SELECT oi."order_id", oi."id", $2, oi."ticket_type_id",
            oi."event_seat_id"
     FROM "order_items" oi
     CROSS JOIN generate_series(1, oi."quantity")
     WHERE oi."order_id" = $1`,
    [target.orderId, target.eventId]
  );

  await executor.query(
    `UPDATE "orders"
     SET "status" = 'paid', "paid_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [target.orderId]
  );
  await executor.query(
    `UPDATE "payments"
     SET "status" = 'succeeded', "updated_at" = CURRENT_TIMESTAMP
     WHERE "order_id" = $1`,
    [target.orderId]
  );

  return {
    outcome: "paid",
    orderId: target.orderId,
    ticketCount: insertedTickets.rowCount ?? 0,
  };
}

/**
 * Records a failed payment attempt. The order stays pending because the
 * provider lets the customer retry against the same logical intent; a late
 * failure event after success or compensation changes nothing.
 */
export async function recordPaymentFailure(
  executor: DatabaseExecutor,
  input: { failureCode: string; providerPaymentIntentId: string }
): Promise<{ orderId: string; recorded: boolean }> {
  const locked = await executor.query<
    { orderId: string; orderStatus: OrderStatus } & QueryResultRow
  >(
    `SELECT o."id" AS "orderId", o."status" AS "orderStatus"
     FROM "payments" p
     JOIN "orders" o ON o."id" = p."order_id"
     WHERE p."provider_payment_intent_id" = $1
     FOR UPDATE OF p, o`,
    [input.providerPaymentIntentId]
  );
  const target = locked.rows[0];
  if (!target) {
    throw new PaymentNotFoundError();
  }
  if (target.orderStatus !== "pending_payment") {
    return { orderId: target.orderId, recorded: false };
  }

  await executor.query(
    `UPDATE "payments"
     SET "last_failure_code" = $2,
         "last_failure_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "provider_payment_intent_id" = $1`,
    [input.providerPaymentIntentId, input.failureCode.slice(0, 80)]
  );
  return { orderId: target.orderId, recorded: true };
}

export interface CompensationTarget {
  amountMinor: number;
  currency: string;
  orderId: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  providerPaymentIntentId: string | null;
  publicNumber: string;
  userId: string | null;
}

/** Reads the refund target without locks; the provider call happens outside. */
export async function loadCompensationTarget(
  executor: DatabaseExecutor,
  orderId: string
): Promise<CompensationTarget> {
  const result = await executor.query<CompensationTarget & QueryResultRow>(
    `SELECT
       o."id" AS "orderId",
       o."public_number" AS "publicNumber",
       o."status" AS "orderStatus",
       o."user_id" AS "userId",
       p."status" AS "paymentStatus",
       p."amount_minor" AS "amountMinor",
       p."currency",
       p."provider_payment_intent_id" AS "providerPaymentIntentId"
     FROM "orders" o
     JOIN "payments" p ON p."order_id" = o."id"
     WHERE o."id" = $1`,
    [orderId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new OrderNotFoundError();
  }
  return row;
}

/**
 * Applies a provider refund result to the compensated order. Idempotent: a
 * repeat delivery of the same refund changes nothing.
 */
export async function applyRefundResult(
  executor: DatabaseExecutor,
  input: { orderId: string; providerRefundId: string; settled: boolean }
): Promise<void> {
  const locked = await executor.query<
    { orderStatus: OrderStatus; paymentStatus: PaymentStatus } & QueryResultRow
  >(
    `SELECT o."status" AS "orderStatus", p."status" AS "paymentStatus"
     FROM "orders" o
     JOIN "payments" p ON p."order_id" = o."id"
     WHERE o."id" = $1
     FOR UPDATE OF p, o`,
    [input.orderId]
  );
  const target = locked.rows[0];
  if (!target) {
    throw new OrderNotFoundError();
  }
  if (target.paymentStatus === "refunded") {
    return;
  }

  if (input.settled) {
    await executor.query(
      `UPDATE "payments"
       SET "status" = 'refunded',
           "provider_refund_id" = $2,
           "refunded_at" = CURRENT_TIMESTAMP,
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "order_id" = $1`,
      [input.orderId, input.providerRefundId]
    );
    await executor.query(
      `UPDATE "orders"
       SET "status" = 'refunded', "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $1 AND "status" = 'payment_conflict'`,
      [input.orderId]
    );
    return;
  }

  await executor.query(
    `UPDATE "payments"
     SET "status" = 'refund_pending',
         "provider_refund_id" = $2,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "order_id" = $1`,
    [input.orderId, input.providerRefundId]
  );
}
