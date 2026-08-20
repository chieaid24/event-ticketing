import type { QueryResultRow } from "pg";

import { hashAuthSecret } from "./auth.js";
import type { TicketTypeKind } from "./events.js";
import { resolveActorKey, type OrderActor } from "./orders.js";
import type { DatabaseExecutor } from "./outbox.js";

export type TicketStatus = "active" | "checked_in" | "void" | "refunded";

// owner view excludes qr hash and raw bearer
export interface TicketAccessRecord {
  eventEndsAt: Date | null;
  eventId: string;
  eventStartsAt: Date | null;
  eventStatus: string;
  eventTimezone: string;
  eventTitle: string;
  id: string;
  orderId: string;
  orderPublicNumber: string;
  publicNumber: string;
  // null until owner first mints usable qr bearer
  qrRotatedAt: Date | null;
  rowLabel: string | null;
  seatAccessible: boolean | null;
  seatLabel: string | null;
  sectionName: string | null;
  status: TicketStatus;
  ticketTypeKind: TicketTypeKind;
  ticketTypeName: string;
  venueDescription: string | null;
  venueName: string;
}

export class TicketNotFoundError extends Error {
  constructor() {
    super("The ticket does not exist.");
    this.name = "TicketNotFoundError";
  }
}

interface TicketAccessRow extends QueryResultRow, TicketAccessRecord {}

const ticketColumns = `
  tk."id",
  tk."public_number" AS "publicNumber",
  tk."status",
  tk."qr_rotated_at" AS "qrRotatedAt",
  tk."order_id" AS "orderId",
  o."public_number" AS "orderPublicNumber",
  e."id" AS "eventId",
  e."title" AS "eventTitle",
  e."timezone" AS "eventTimezone",
  e."starts_at" AS "eventStartsAt",
  e."ends_at" AS "eventEndsAt",
  e."status" AS "eventStatus",
  v."name" AS "venueName",
  v."description" AS "venueDescription",
  t."name" AS "ticketTypeName",
  t."kind" AS "ticketTypeKind",
  s."section_name" AS "sectionName",
  s."row_label" AS "rowLabel",
  s."seat_label" AS "seatLabel",
  s."accessible" AS "seatAccessible"
`;

const ticketJoins = `
  FROM "tickets" tk
  JOIN "orders" o ON o."id" = tk."order_id"
  JOIN "events" e ON e."id" = tk."event_id"
  JOIN "venues" v ON v."id" = e."venue_id"
  JOIN "ticket_types" t ON t."id" = tk."ticket_type_id"
  LEFT JOIN "event_seats" s ON s."id" = tk."event_seat_id"
`;

export async function listTicketsForActor(
  executor: DatabaseExecutor,
  input: { actor: OrderActor }
): Promise<TicketAccessRecord[]> {
  const actorKey = resolveActorKey(input.actor);
  const result = await executor.query<TicketAccessRow>(
    `SELECT ${ticketColumns}
     ${ticketJoins}
     WHERE o."actor_key" = $1
     ORDER BY o."created_at" DESC, tk."public_number" ASC`,
    [actorKey]
  );
  return result.rows;
}

export async function loadTicketForActor(
  executor: DatabaseExecutor,
  input: { actor: OrderActor; ticketId: string }
): Promise<TicketAccessRecord> {
  const actorKey = resolveActorKey(input.actor);
  const result = await executor.query<TicketAccessRow>(
    `SELECT ${ticketColumns}
     ${ticketJoins}
     WHERE tk."id" = $1 AND o."actor_key" = $2`,
    [input.ticketId, actorKey]
  );
  const row = result.rows[0];
  if (!row) {
    throw new TicketNotFoundError();
  }
  return row;
}

export type RotateTicketOutcome =
  // fresh bearer minted; prior no longer matches
  | { outcome: "rotated"; publicNumber: string; rotatedAt: Date }
  // ticket not active, no redeemable credential
  | { outcome: "not_active"; status: TicketStatus };

// store fresh qr hash only; rotation atomically invalidates prior bearer
export async function rotateTicketQrToken(
  executor: DatabaseExecutor,
  input: { actor: OrderActor; ticketId: string; tokenHash: string }
): Promise<RotateTicketOutcome> {
  const actorKey = resolveActorKey(input.actor);
  const updated = await executor.query<
    { publicNumber: string; rotatedAt: Date } & QueryResultRow
  >(
    `UPDATE "tickets" tk
     SET "qr_token_hash" = $3, "qr_rotated_at" = CURRENT_TIMESTAMP
     FROM "orders" o
     WHERE tk."id" = $1
       AND o."id" = tk."order_id"
       AND o."actor_key" = $2
       AND tk."status" = 'active'
     RETURNING tk."public_number" AS "publicNumber",
               tk."qr_rotated_at" AS "rotatedAt"`,
    [input.ticketId, actorKey, input.tokenHash]
  );
  const row = updated.rows[0];
  if (row) {
    return {
      outcome: "rotated",
      publicNumber: row.publicNumber,
      rotatedAt: row.rotatedAt,
    };
  }

  // no active row moved: actor doesnt own it (absent) or it's void; read distinguishes
  const existing = await loadTicketForActor(executor, {
    actor: input.actor,
    ticketId: input.ticketId,
  });
  return { outcome: "not_active", status: existing.status };
}

// store and compare qr hashes only
export function hashQrToken(token: string): string {
  return hashAuthSecret(token);
}
