import type { QueryResultRow } from "pg";

import { enqueueOutboxEvent, type DatabaseExecutor } from "./outbox.js";

export type RefundStatus =
  "requested" | "provider_pending" | "succeeded" | "failed";

export type RefundInitiator = "customer" | "organizer";

export interface RefundItemInput {
  orderItemId: string;
  quantity: number;
}

export interface RefundItemRecord extends RefundItemInput {
  amountMinor: number;
}

export interface RefundRecord {
  amountMinor: number;
  completedAt: Date | null;
  createdAt: Date;
  currency: string;
  id: string;
  initiator: RefundInitiator;
  inventoryReturnedAt: Date | null;
  items: RefundItemRecord[];
  orderId: string;
  providerRefundId: string | null;
  reason: string | null;
  status: RefundStatus;
}

export interface RefundTarget extends RefundRecord {
  eventTitle: string;
  orderPublicNumber: string;
  paymentAmountMinor: number;
  paymentStatus: string;
  provider: string;
  providerPaymentIntentId: string | null;
  userEmail: string | null;
}

export interface NotificationRecord {
  attemptCount: number;
  id: string;
  kind: string;
  recipientEmail: string;
  status: "queued" | "failed" | "sent" | "suppressed";
  subject: string;
  text: string;
}

export interface OrderNotificationContext {
  currency: string;
  eventStartsAt: Date | null;
  eventTitle: string;
  publicNumber: string;
  totalMinor: number;
}

export class RefundNotFoundError extends Error {
  constructor() {
    super("The refund target does not exist.");
    this.name = "RefundNotFoundError";
  }
}

export class RefundStateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RefundStateError";
    this.code = code;
  }
}

interface RefundRow extends QueryResultRow {
  amountMinor: number;
  completedAt: Date | null;
  createdAt: Date;
  currency: string;
  id: string;
  initiator: RefundInitiator;
  inventoryReturnedAt: Date | null;
  orderId: string;
  providerRefundId: string | null;
  reason: string | null;
  status: RefundStatus;
}

const refundColumns = `
  r."id",
  r."order_id" AS "orderId",
  r."initiator",
  r."status",
  r."reason",
  r."amount_minor" AS "amountMinor",
  r."currency",
  r."provider_refund_id" AS "providerRefundId",
  r."inventory_returned_at" AS "inventoryReturnedAt",
  r."completed_at" AS "completedAt",
  r."created_at" AS "createdAt"
`;

async function loadRefundItems(
  executor: DatabaseExecutor,
  refundId: string
): Promise<RefundItemRecord[]> {
  const result = await executor.query<RefundItemRecord & QueryResultRow>(
    `SELECT
       "order_item_id" AS "orderItemId",
       "quantity",
       "amount_minor" AS "amountMinor"
     FROM "refund_items"
     WHERE "refund_id" = $1
     ORDER BY "order_item_id"`,
    [refundId]
  );
  return result.rows;
}

async function assembleRefund(
  executor: DatabaseExecutor,
  row: RefundRow
): Promise<RefundRecord> {
  return {
    ...row,
    items: await loadRefundItems(executor, row.id),
  };
}

export async function createRefund(
  executor: DatabaseExecutor,
  input: {
    actorUserId: string;
    idempotencyKey: string;
    initiator: RefundInitiator;
    items: RefundItemInput[];
    orderId: string;
    organizationId?: string;
    reason?: string;
  }
): Promise<RefundRecord> {
  const targetResult = await executor.query<
    {
      currency: string;
      customerEligible: boolean;
      customerRefundsEnabled: boolean;
      organizationId: string;
      orderStatus: string;
      paymentStatus: string;
      userId: string | null;
    } & QueryResultRow
  >(
    `SELECT
       o."user_id" AS "userId",
       o."status" AS "orderStatus",
       o."currency",
       e."organization_id" AS "organizationId",
       e."customer_refunds_enabled" AS "customerRefundsEnabled",
       (
         e."customer_refunds_enabled"
         AND e."starts_at" IS NOT NULL
         AND CURRENT_TIMESTAMP
           < e."starts_at"
             - make_interval(mins => e."customer_refund_cutoff_minutes")
       ) AS "customerEligible",
       p."status" AS "paymentStatus"
     FROM "orders" o
     JOIN "events" e ON e."id" = o."event_id"
     JOIN "payments" p ON p."order_id" = o."id"
     WHERE o."id" = $1
     FOR UPDATE OF o, e, p`,
    [input.orderId]
  );
  const target = targetResult.rows[0];
  if (
    !target ||
    (input.initiator === "customer" && target.userId !== input.actorUserId) ||
    (input.initiator === "organizer" &&
      target.organizationId !== input.organizationId)
  ) {
    throw new RefundNotFoundError();
  }

  const replay = await executor.query<RefundRow>(
    `SELECT ${refundColumns}
     FROM "refunds" r
     WHERE r."order_id" = $1 AND r."request_key" = $2`,
    [input.orderId, input.idempotencyKey]
  );
  if (replay.rows[0]) {
    return assembleRefund(executor, replay.rows[0]);
  }

  if (target.orderStatus !== "paid" || target.paymentStatus !== "succeeded") {
    throw new RefundStateError(
      "order_not_refundable",
      "Only a paid order with a settled payment can be refunded."
    );
  }
  if (input.initiator === "customer" && !target.customerEligible) {
    throw new RefundStateError(
      target.customerRefundsEnabled
        ? "refund_window_closed"
        : "customer_refunds_disabled",
      target.customerRefundsEnabled
        ? "The customer refund window has closed."
        : "This event does not accept customer refund requests."
    );
  }

  const lines = await executor.query<
    {
      alreadyRequested: number;
      id: string;
      quantity: number;
      unitFeeMinor: number;
      unitPriceMinor: number;
    } & QueryResultRow
  >(
    `SELECT
       oi."id",
       oi."quantity",
       oi."unit_price_minor" AS "unitPriceMinor",
       oi."unit_fee_minor" AS "unitFeeMinor",
       COALESCE((
         SELECT sum(ri."quantity")::int
         FROM "refund_items" ri
         JOIN "refunds" r ON r."id" = ri."refund_id"
         WHERE ri."order_item_id" = oi."id"
           AND r."status" IN ('requested', 'provider_pending', 'succeeded')
       ), 0)::int AS "alreadyRequested"
     FROM "order_items" oi
     WHERE oi."order_id" = $1
     ORDER BY oi."id"
     FOR UPDATE OF oi`,
    [input.orderId]
  );
  const linesById = new Map(lines.rows.map((line) => [line.id, line]));
  const pricedItems: RefundItemRecord[] = [];
  for (const item of input.items) {
    const line = linesById.get(item.orderItemId);
    if (!line) {
      throw new RefundStateError(
        "refund_item_not_found",
        "A requested item does not belong to this order."
      );
    }
    if (item.quantity > line.quantity - line.alreadyRequested) {
      throw new RefundStateError(
        "refund_quantity_exceeded",
        "A requested quantity exceeds the refundable quantity."
      );
    }
    pricedItems.push({
      amountMinor: item.quantity * (line.unitPriceMinor + line.unitFeeMinor),
      orderItemId: item.orderItemId,
      quantity: item.quantity,
    });
  }
  const amountMinor = pricedItems.reduce(
    (total, item) => total + item.amountMinor,
    0
  );
  if (amountMinor <= 0) {
    throw new RefundStateError(
      "refund_amount_zero",
      "The selected items have no refundable payment value."
    );
  }

  const inserted = await executor.query<RefundRow>(
    `INSERT INTO "refunds"
       ("order_id", "actor_user_id", "request_key", "initiator", "reason",
        "amount_minor", "currency")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${refundColumns.replaceAll('r."', '"')}`,
    [
      input.orderId,
      input.actorUserId,
      input.idempotencyKey,
      input.initiator,
      input.reason ?? null,
      amountMinor,
      target.currency,
    ]
  );
  const refund = inserted.rows[0]!;
  await executor.query(
    `INSERT INTO "refund_items"
       ("refund_id", "order_item_id", "quantity", "amount_minor")
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::int[], $4::int[])`,
    [
      pricedItems.map(() => refund.id),
      pricedItems.map((item) => item.orderItemId),
      pricedItems.map((item) => item.quantity),
      pricedItems.map((item) => item.amountMinor),
    ]
  );
  await enqueueOutboxEvent(executor, {
    aggregateId: refund.id,
    aggregateType: "refund",
    deduplicationKey: `refund.requested:${refund.id}`,
    payload: { refundId: refund.id },
    topic: "refund.requested",
  });
  return { ...refund, items: pricedItems };
}

export async function listRefundsForCustomer(
  executor: DatabaseExecutor,
  input: { orderId: string; userId: string }
): Promise<RefundRecord[]> {
  const rows = await executor.query<RefundRow>(
    `SELECT ${refundColumns}
     FROM "refunds" r
     JOIN "orders" o ON o."id" = r."order_id"
     WHERE r."order_id" = $1 AND o."user_id" = $2
     ORDER BY r."created_at" DESC, r."id"`,
    [input.orderId, input.userId]
  );
  return Promise.all(rows.rows.map((row) => assembleRefund(executor, row)));
}

export async function loadRefundTarget(
  executor: DatabaseExecutor,
  refundId: string
): Promise<RefundTarget> {
  const result = await executor.query<
    RefundRow & {
      eventTitle: string;
      orderPublicNumber: string;
      paymentAmountMinor: number;
      paymentStatus: string;
      provider: string;
      providerPaymentIntentId: string | null;
      userEmail: string | null;
    } & QueryResultRow
  >(
    `SELECT
       ${refundColumns},
       o."public_number" AS "orderPublicNumber",
       e."title" AS "eventTitle",
       p."provider",
       p."provider_payment_intent_id" AS "providerPaymentIntentId",
       p."amount_minor" AS "paymentAmountMinor",
       p."status" AS "paymentStatus",
       u."email" AS "userEmail"
     FROM "refunds" r
     JOIN "orders" o ON o."id" = r."order_id"
     JOIN "events" e ON e."id" = o."event_id"
     JOIN "payments" p ON p."order_id" = o."id"
     LEFT JOIN "users" u ON u."id" = o."user_id"
     WHERE r."id" = $1`,
    [refundId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new RefundNotFoundError();
  }
  return { ...row, items: await loadRefundItems(executor, row.id) };
}

export async function attachRefundProviderReference(
  executor: DatabaseExecutor,
  input: { providerRefundId: string; refundId: string }
): Promise<void> {
  const result = await executor.query(
    `UPDATE "refunds"
     SET "provider_refund_id" = $2,
         "status" = 'provider_pending',
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1
       AND "status" IN ('requested', 'provider_pending')
       AND ("provider_refund_id" IS NULL OR "provider_refund_id" = $2)`,
    [input.refundId, input.providerRefundId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new RefundStateError(
      "refund_provider_conflict",
      "The refund already references another provider refund."
    );
  }
}

export async function markRefundProviderFailure(
  executor: DatabaseExecutor,
  input: {
    amountMinor: number;
    code: string;
    currency: string;
    providerPaymentIntentId: string;
    providerRefundId: string;
    refundId: string;
  }
): Promise<{ orderId: string; replayed: boolean }> {
  const locked = await executor.query<
    {
      amountMinor: number;
      currency: string;
      orderId: string;
      providerPaymentIntentId: string | null;
      providerRefundId: string | null;
      status: RefundStatus;
    } & QueryResultRow
  >(
    `SELECT
       r."order_id" AS "orderId",
       r."status",
       r."amount_minor" AS "amountMinor",
       r."currency",
       r."provider_refund_id" AS "providerRefundId",
       p."provider_payment_intent_id" AS "providerPaymentIntentId"
     FROM "refunds" r
     JOIN "orders" o ON o."id" = r."order_id"
     JOIN "payments" p ON p."order_id" = o."id"
     WHERE r."id" = $1
     FOR UPDATE OF r, o, p`,
    [input.refundId]
  );
  const target = locked.rows[0];
  if (!target) {
    throw new RefundNotFoundError();
  }
  if (target.status === "failed") {
    return { orderId: target.orderId, replayed: true };
  }
  if (
    target.status !== "provider_pending" ||
    target.providerPaymentIntentId !== input.providerPaymentIntentId ||
    target.providerRefundId !== input.providerRefundId ||
    target.amountMinor !== input.amountMinor ||
    target.currency.toUpperCase() !== input.currency.toUpperCase()
  ) {
    throw new RefundStateError(
      "refund_verification_failed",
      "The provider refund does not match the requested refund."
    );
  }
  await executor.query(
    `UPDATE "refunds"
     SET "status" = 'failed',
         "provider_failure_code" = $2,
         "completed_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" IN ('requested', 'provider_pending')`,
    [input.refundId, input.code.slice(0, 80)]
  );
  return { orderId: target.orderId, replayed: false };
}

export async function finalizeRefund(
  executor: DatabaseExecutor,
  input: {
    amountMinor: number;
    currency: string;
    providerPaymentIntentId: string;
    providerRefundId: string;
    refundId: string;
  }
): Promise<{
  inventoryReturned: boolean;
  orderId: string;
  replayed: boolean;
}> {
  const locked = await executor.query<
    {
      amountMinor: number;
      currency: string;
      inventoryEligible: boolean;
      orderId: string;
      paymentAmountMinor: number;
      providerPaymentIntentId: string | null;
      providerRefundId: string | null;
      status: RefundStatus;
    } & QueryResultRow
  >(
    `SELECT
       r."order_id" AS "orderId",
       r."status",
       r."amount_minor" AS "amountMinor",
       r."currency",
       r."provider_refund_id" AS "providerRefundId",
       p."amount_minor" AS "paymentAmountMinor",
       p."provider_payment_intent_id" AS "providerPaymentIntentId",
       (
         e."starts_at" IS NOT NULL
         AND CURRENT_TIMESTAMP < e."starts_at"
         AND CURRENT_TIMESTAMP
           < e."starts_at"
             - make_interval(mins => e."inventory_return_cutoff_minutes")
       ) AS "inventoryEligible"
     FROM "refunds" r
     JOIN "orders" o ON o."id" = r."order_id"
     JOIN "payments" p ON p."order_id" = o."id"
     JOIN "events" e ON e."id" = o."event_id"
     WHERE r."id" = $1
     FOR UPDATE OF r, o, p, e`,
    [input.refundId]
  );
  const target = locked.rows[0];
  if (!target) {
    throw new RefundNotFoundError();
  }
  if (target.status === "succeeded") {
    return {
      inventoryReturned: target.inventoryEligible,
      orderId: target.orderId,
      replayed: true,
    };
  }
  if (
    target.status !== "provider_pending" ||
    target.providerPaymentIntentId !== input.providerPaymentIntentId ||
    target.providerRefundId !== input.providerRefundId ||
    target.amountMinor !== input.amountMinor ||
    target.currency.toUpperCase() !== input.currency.toUpperCase()
  ) {
    throw new RefundStateError(
      "refund_verification_failed",
      "The provider refund does not match the requested refund."
    );
  }

  const items = await executor.query<
    {
      eventSeatId: string | null;
      orderItemId: string;
      quantity: number;
      ticketTypeId: string;
    } & QueryResultRow
  >(
    `SELECT
       ri."order_item_id" AS "orderItemId",
       ri."quantity",
       oi."ticket_type_id" AS "ticketTypeId",
       oi."event_seat_id" AS "eventSeatId"
     FROM "refund_items" ri
     JOIN "order_items" oi ON oi."id" = ri."order_item_id"
     WHERE ri."refund_id" = $1
     ORDER BY oi."ticket_type_id", oi."id"`,
    [input.refundId]
  );

  for (const item of items.rows) {
    const updated = await executor.query(
      `WITH selected AS (
         SELECT "id"
         FROM "tickets"
         WHERE "order_item_id" = $1
           AND "status" IN ('active', 'checked_in')
         ORDER BY "id"
         LIMIT $2
         FOR UPDATE
       )
       UPDATE "tickets" t
       SET "status" = 'refunded'
       FROM selected
       WHERE t."id" = selected."id"`,
      [item.orderItemId, item.quantity]
    );
    if ((updated.rowCount ?? 0) !== item.quantity) {
      throw new RefundStateError(
        "ticket_refund_failed",
        "The refundable ticket quantity is no longer available."
      );
    }

    if (!target.inventoryEligible) {
      continue;
    }
    if (item.eventSeatId) {
      const returned = await executor.query(
        `UPDATE "event_seats"
         SET "status" = 'available', "hold_id" = NULL
         WHERE "id" = $1 AND "status" = 'sold'`,
        [item.eventSeatId]
      );
      if ((returned.rowCount ?? 0) !== 1) {
        throw new RefundStateError(
          "inventory_return_failed",
          "The assigned seat could not return to inventory."
        );
      }
    } else {
      const returned = await executor.query(
        `UPDATE "ticket_types"
         SET "sold_quantity" = "sold_quantity" - $2
         WHERE "id" = $1 AND "sold_quantity" >= $2`,
        [item.ticketTypeId, item.quantity]
      );
      if ((returned.rowCount ?? 0) !== 1) {
        throw new RefundStateError(
          "inventory_return_failed",
          "The general-admission inventory could not be returned."
        );
      }
    }
  }

  await executor.query(
    `UPDATE "refunds"
     SET "status" = 'succeeded',
         "completed_at" = CURRENT_TIMESTAMP,
         "inventory_returned_at" =
           CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE NULL END,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [input.refundId, target.inventoryEligible]
  );
  const totals = await executor.query<{ total: number } & QueryResultRow>(
    `SELECT COALESCE(sum("amount_minor"), 0)::int AS "total"
     FROM "refunds"
     WHERE "order_id" = $1 AND "status" = 'succeeded'`,
    [target.orderId]
  );
  if ((totals.rows[0]?.total ?? 0) >= target.paymentAmountMinor) {
    await suppressOrderNotificationKind(executor, {
      code: "order_refunded",
      kind: "event_reminder",
      orderId: target.orderId,
    });
    await executor.query(
      `UPDATE "orders"
       SET "status" = 'refunded', "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [target.orderId]
    );
    await executor.query(
      `UPDATE "payments"
       SET "status" = 'refunded',
           "refunded_at" = CURRENT_TIMESTAMP,
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "order_id" = $1`,
      [target.orderId]
    );
  }
  return {
    inventoryReturned: target.inventoryEligible,
    orderId: target.orderId,
    replayed: false,
  };
}

export async function queueOrderNotification(
  executor: DatabaseExecutor,
  input: {
    availableAt?: Date;
    deduplicationKey: string;
    kind: string;
    orderId: string;
    subject: string;
    text: string;
  }
): Promise<string | null> {
  const inserted = await executor.query<{ id: string } & QueryResultRow>(
    `INSERT INTO "notifications"
       ("order_id", "user_id", "kind", "recipient_email",
        "deduplication_key", "payload")
     SELECT o."id", u."id", $2, u."email", $3, $4::jsonb
     FROM "orders" o
     JOIN "users" u ON u."id" = o."user_id"
     WHERE o."id" = $1
     ON CONFLICT ("deduplication_key") DO NOTHING
     RETURNING "id"`,
    [
      input.orderId,
      input.kind,
      input.deduplicationKey,
      JSON.stringify({ subject: input.subject, text: input.text }),
    ]
  );
  const notificationId = inserted.rows[0]?.id;
  if (!notificationId) {
    return null;
  }
  await enqueueOutboxEvent(executor, {
    aggregateId: notificationId,
    aggregateType: "notification",
    ...(input.availableAt ? { availableAt: input.availableAt } : {}),
    deduplicationKey: `notification.send:${notificationId}`,
    payload: { notificationId },
    topic: "notification.send",
  });
  return notificationId;
}

export async function loadOrderNotificationContext(
  executor: DatabaseExecutor,
  orderId: string
): Promise<OrderNotificationContext | null> {
  const result = await executor.query<
    OrderNotificationContext & QueryResultRow
  >(
    `SELECT
       o."public_number" AS "publicNumber",
       o."total_minor" AS "totalMinor",
       o."currency",
       e."title" AS "eventTitle",
       e."starts_at" AS "eventStartsAt"
     FROM "orders" o
     JOIN "events" e ON e."id" = o."event_id"
     WHERE o."id" = $1 AND o."user_id" IS NOT NULL`,
    [orderId]
  );
  return result.rows[0] ?? null;
}

export async function loadNotification(
  executor: DatabaseExecutor,
  notificationId: string
): Promise<NotificationRecord | null> {
  const result = await executor.query<
    {
      attemptCount: number;
      id: string;
      kind: string;
      payload: { subject?: unknown; text?: unknown };
      recipientEmail: string;
      status: NotificationRecord["status"];
    } & QueryResultRow
  >(
    `SELECT
       "id", "kind", "recipient_email" AS "recipientEmail", "status",
       "attempt_count" AS "attemptCount", "payload"
     FROM "notifications"
     WHERE "id" = $1`,
    [notificationId]
  );
  const row = result.rows[0];
  if (
    !row ||
    typeof row.payload?.subject !== "string" ||
    typeof row.payload.text !== "string"
  ) {
    return null;
  }
  return {
    attemptCount: row.attemptCount,
    id: row.id,
    kind: row.kind,
    recipientEmail: row.recipientEmail,
    status: row.status,
    subject: row.payload.subject,
    text: row.payload.text,
  };
}

export async function recordNotificationFailure(
  executor: DatabaseExecutor,
  input: { code: string; notificationId: string }
): Promise<void> {
  await executor.query(
    `UPDATE "notifications"
     SET "status" = 'failed',
         "attempt_count" = "attempt_count" + 1,
         "last_error_code" = $2,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" IN ('queued', 'failed')`,
    [input.notificationId, input.code.slice(0, 80)]
  );
}

export async function markNotificationSent(
  executor: DatabaseExecutor,
  notificationId: string
): Promise<void> {
  await executor.query(
    `UPDATE "notifications"
     SET "status" = 'sent',
         "attempt_count" = "attempt_count" + 1,
         "last_error_code" = NULL,
         "sent_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" IN ('queued', 'failed')`,
    [notificationId]
  );
}

export async function suppressNotification(
  executor: DatabaseExecutor,
  input: { code: string; notificationId: string }
): Promise<void> {
  await executor.query(
    `UPDATE "notifications"
     SET "status" = 'suppressed',
         "attempt_count" = "attempt_count" + 1,
         "last_error_code" = $2,
         "suppressed_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" IN ('queued', 'failed')`,
    [input.notificationId, input.code.slice(0, 80)]
  );
}

export async function suppressOrderNotificationKind(
  executor: DatabaseExecutor,
  input: { code: string; kind: string; orderId: string }
): Promise<void> {
  await executor.query(
    `UPDATE "notifications"
     SET "status" = 'suppressed',
         "last_error_code" = $3,
         "suppressed_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "order_id" = $1
       AND "kind" = $2
       AND "status" IN ('queued', 'failed')`,
    [input.orderId, input.kind, input.code.slice(0, 80)]
  );
}
