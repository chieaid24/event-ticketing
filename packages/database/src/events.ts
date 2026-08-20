import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "./outbox.js";

export type EventStatus =
  | "draft"
  | "published"
  | "sales_paused"
  | "postponed"
  | "cancelled"
  | "completed"
  | "archived";

export type TicketTypeKind = "assigned" | "general_admission";

export interface EventRow extends QueryResultRow {
  createdAt: Date;
  currency: string;
  customerRefundCutoffMinutes: number;
  customerRefundsEnabled: boolean;
  description: string | null;
  endsAt: Date | null;
  holdDurationSeconds: number;
  id: string;
  inventoryReturnCutoffMinutes: number;
  mediaUrl: string | null;
  organizationId: string;
  publishedAt: Date | null;
  refundPolicy: string | null;
  salesEndAt: Date | null;
  salesStartAt: Date | null;
  startsAt: Date | null;
  status: EventStatus;
  timezone: string;
  title: string;
  updatedAt: Date;
  venueId: string;
  version: number;
  waitingRoomEnabled: boolean;
}

export interface EventSummaryRow extends QueryResultRow {
  capacity: number;
  currency: string;
  id: string;
  startsAt: Date | null;
  status: EventStatus;
  ticketTypeCount: number;
  title: string;
  updatedAt: Date;
  venueId: string;
  venueName: string;
  version: number;
}

export interface TicketTypeRow extends QueryResultRow {
  capacity: number | null;
  feeMinor: number;
  id: string;
  kind: TicketTypeKind;
  name: string;
  position: number;
  priceMinor: number;
  sectionName: string;
}

export interface VenueSectionSummaryData {
  capacity: number;
  kind: TicketTypeKind;
  name: string;
  seatCount: number;
}

export interface SeatSnapshotData {
  accessible: boolean;
  companion: boolean;
  rowLabel: string;
  seatLabel: string;
  x: number;
  y: number;
}

export interface TicketTypeInputData {
  capacity: number | null;
  feeMinor: number;
  kind: TicketTypeKind;
  name: string;
  priceMinor: number;
  sectionName: string;
}

export interface UpdateEventDraftInput {
  currency: string;
  customerRefundCutoffMinutes: number;
  customerRefundsEnabled: boolean;
  description: string | null;
  endsAt: Date | null;
  eventId: string;
  expectedVersion: number;
  holdDurationSeconds: number;
  inventoryReturnCutoffMinutes: number;
  mediaUrl: string | null;
  organizationId: string;
  refundPolicy: string | null;
  salesEndAt: Date | null;
  salesStartAt: Date | null;
  startsAt: Date | null;
  timezone: string;
  title: string;
  waitingRoomEnabled: boolean;
}

const eventColumns = `
  "id",
  "organization_id" AS "organizationId",
  "venue_id" AS "venueId",
  "title",
  "description",
  "status",
  "timezone",
  "currency",
  "customer_refunds_enabled" AS "customerRefundsEnabled",
  "customer_refund_cutoff_minutes" AS "customerRefundCutoffMinutes",
  "inventory_return_cutoff_minutes" AS "inventoryReturnCutoffMinutes",
  "starts_at" AS "startsAt",
  "ends_at" AS "endsAt",
  "sales_start_at" AS "salesStartAt",
  "sales_end_at" AS "salesEndAt",
  "hold_duration_seconds" AS "holdDurationSeconds",
  "waiting_room_enabled" AS "waitingRoomEnabled",
  "refund_policy" AS "refundPolicy",
  "media_url" AS "mediaUrl",
  "published_at" AS "publishedAt",
  "version",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`;

const ticketTypeColumns = `
  "id",
  "name",
  "kind",
  "section_name" AS "sectionName",
  "price_minor" AS "priceMinor",
  "fee_minor" AS "feeMinor",
  "capacity",
  "position"
`;

export async function insertEvent(
  executor: DatabaseExecutor,
  input: { organizationId: string; title: string; venueId: string }
): Promise<EventRow> {
  const result = await executor.query<EventRow>(
    `INSERT INTO "events" ("organization_id", "venue_id", "title")
     VALUES ($1, $2, $3)
     RETURNING ${eventColumns}`,
    [input.organizationId, input.venueId, input.title]
  );
  return result.rows[0]!;
}

export async function findEventById(
  executor: DatabaseExecutor,
  input: { eventId: string; organizationId: string }
): Promise<EventRow | null> {
  const result = await executor.query<EventRow>(
    `SELECT ${eventColumns} FROM "events"
     WHERE "id" = $1 AND "organization_id" = $2`,
    [input.eventId, input.organizationId]
  );
  return result.rows[0] ?? null;
}

// capacity combines published seats with ga config
export async function listEventsForOrganization(
  executor: DatabaseExecutor,
  organizationId: string
): Promise<EventSummaryRow[]> {
  const result = await executor.query<EventSummaryRow>(
    `SELECT
       e."id",
       e."title",
       e."status",
       e."currency",
       e."venue_id" AS "venueId",
       v."name" AS "venueName",
       e."starts_at" AS "startsAt",
       e."version",
       e."updated_at" AS "updatedAt",
       (
         SELECT count(*)::int FROM "ticket_types" t
         WHERE t."event_id" = e."id"
       ) AS "ticketTypeCount",
       (
         (
           SELECT count(*)::int FROM "event_seats" s
           WHERE s."event_id" = e."id"
         )
         + (
           SELECT COALESCE(sum(t."capacity"), 0)::int
           FROM "ticket_types" t
           WHERE t."event_id" = e."id"
             AND t."kind" = 'general_admission'
         )
       ) AS "capacity"
     FROM "events" e
     JOIN "venues" v ON v."id" = e."venue_id"
     WHERE e."organization_id" = $1
     ORDER BY e."starts_at" NULLS LAST, e."title", e."id"`,
    [organizationId]
  );
  return result.rows;
}

// cas miss returns null
export async function updateEventDraft(
  executor: DatabaseExecutor,
  input: UpdateEventDraftInput
): Promise<EventRow | null> {
  const result = await executor.query<EventRow>(
    `UPDATE "events"
     SET "title" = $3,
         "description" = $4,
         "timezone" = $5,
         "currency" = $6,
         "starts_at" = $7,
         "ends_at" = $8,
         "sales_start_at" = $9,
         "sales_end_at" = $10,
         "hold_duration_seconds" = $11,
         "waiting_room_enabled" = $12,
         "refund_policy" = $13,
         "customer_refunds_enabled" = $14,
         "customer_refund_cutoff_minutes" = $15,
         "inventory_return_cutoff_minutes" = $16,
         "media_url" = $17,
         "version" = "version" + 1,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2 AND "version" = $18
       AND "status" = 'draft'
     RETURNING ${eventColumns}`,
    [
      input.eventId,
      input.organizationId,
      input.title,
      input.description,
      input.timezone,
      input.currency,
      input.startsAt,
      input.endsAt,
      input.salesStartAt,
      input.salesEndAt,
      input.holdDurationSeconds,
      input.waitingRoomEnabled,
      input.refundPolicy,
      input.customerRefundsEnabled,
      input.customerRefundCutoffMinutes,
      input.inventoryReturnCutoffMinutes,
      input.mediaUrl,
      input.expectedVersion,
    ]
  );
  return result.rows[0] ?? null;
}

// version bump also locks; stale write returns null
export async function claimEventVersion(
  executor: DatabaseExecutor,
  input: { eventId: string; expectedVersion: number; organizationId: string }
): Promise<EventRow | null> {
  const result = await executor.query<EventRow>(
    `UPDATE "events"
     SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2 AND "version" = $3
       AND "status" = 'draft'
     RETURNING ${eventColumns}`,
    [input.eventId, input.organizationId, input.expectedVersion]
  );
  return result.rows[0] ?? null;
}

export async function markEventCancelled(
  executor: DatabaseExecutor,
  input: { eventId: string; expectedVersion: number; organizationId: string }
): Promise<EventRow | null> {
  const result = await executor.query<EventRow>(
    `UPDATE "events"
     SET "status" = 'cancelled',
         "version" = "version" + 1,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2 AND "version" = $3
       AND "status" IN ('published', 'sales_paused', 'postponed')
     RETURNING ${eventColumns}`,
    [input.eventId, input.organizationId, input.expectedVersion]
  );
  return result.rows[0] ?? null;
}

export async function fetchTicketTypes(
  executor: DatabaseExecutor,
  eventId: string
): Promise<TicketTypeRow[]> {
  const result = await executor.query<TicketTypeRow>(
    `SELECT ${ticketTypeColumns} FROM "ticket_types"
     WHERE "event_id" = $1
     ORDER BY "position", "name"`,
    [eventId]
  );
  return result.rows;
}

// caller tx makes full replacement atomic
export async function replaceTicketTypes(
  executor: DatabaseExecutor,
  input: { eventId: string; ticketTypes: TicketTypeInputData[] }
): Promise<void> {
  await executor.query(`DELETE FROM "ticket_types" WHERE "event_id" = $1`, [
    input.eventId,
  ]);

  if (input.ticketTypes.length === 0) {
    return;
  }

  const ids: string[] = [];
  const eventIds: string[] = [];
  const names: string[] = [];
  const kinds: TicketTypeKind[] = [];
  const sectionNames: string[] = [];
  const priceMinors: number[] = [];
  const feeMinors: number[] = [];
  const capacities: (number | null)[] = [];
  const positions: number[] = [];
  for (const [index, ticketType] of input.ticketTypes.entries()) {
    ids.push(randomUUID());
    eventIds.push(input.eventId);
    names.push(ticketType.name);
    kinds.push(ticketType.kind);
    sectionNames.push(ticketType.sectionName);
    priceMinors.push(ticketType.priceMinor);
    feeMinors.push(ticketType.feeMinor);
    capacities.push(ticketType.capacity);
    positions.push(index);
  }

  await executor.query(
    `INSERT INTO "ticket_types"
       ("id", "event_id", "name", "kind", "section_name",
        "price_minor", "fee_minor", "capacity", "position")
     SELECT * FROM unnest(
       $1::uuid[], $2::uuid[], $3::varchar[], $4::ticket_type_kind[],
       $5::varchar[], $6::int[], $7::int[], $8::int[], $9::int[]
     )`,
    [
      ids,
      eventIds,
      names,
      kinds,
      sectionNames,
      priceMinors,
      feeMinors,
      capacities,
      positions,
    ]
  );
}

export async function fetchVenueSectionSummaries(
  executor: DatabaseExecutor,
  venueId: string
): Promise<VenueSectionSummaryData[]> {
  const result = await executor.query<{
    capacity: number;
    kind: TicketTypeKind;
    name: string;
    seatCount: number;
  }>(
    `SELECT
       s."name",
       s."kind",
       COALESCE(s."ga_capacity", 0)::int AS "capacity",
       (
         SELECT count(*)::int
         FROM "venue_seats" st
         JOIN "venue_rows" r ON r."id" = st."row_id"
         WHERE r."section_id" = s."id"
       ) AS "seatCount"
     FROM "venue_sections" s
     WHERE s."venue_id" = $1
     ORDER BY s."position", s."name"`,
    [venueId]
  );
  return result.rows;
}

export async function fetchSectionSeats(
  executor: DatabaseExecutor,
  input: { sectionName: string; venueId: string }
): Promise<SeatSnapshotData[]> {
  const result = await executor.query<SeatSnapshotData>(
    `SELECT
       r."label" AS "rowLabel",
       st."label" AS "seatLabel",
       st."x",
       st."y",
       st."accessible",
       st."companion"
     FROM "venue_sections" s
     JOIN "venue_rows" r ON r."section_id" = s."id"
     JOIN "venue_seats" st ON st."row_id" = r."id"
     WHERE s."venue_id" = $1 AND s."name" = $2
     ORDER BY r."position", st."x", st."label"`,
    [input.venueId, input.sectionName]
  );
  return result.rows;
}

export async function insertEventSeats(
  executor: DatabaseExecutor,
  input: {
    eventId: string;
    priceMinor: number;
    sectionName: string;
    seats: SeatSnapshotData[];
    ticketTypeId: string;
  }
): Promise<void> {
  if (input.seats.length === 0) {
    return;
  }

  const eventIds: string[] = [];
  const ticketTypeIds: string[] = [];
  const sectionNames: string[] = [];
  const rowLabels: string[] = [];
  const seatLabels: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const accessibles: boolean[] = [];
  const companions: boolean[] = [];
  const prices: number[] = [];
  for (const seat of input.seats) {
    eventIds.push(input.eventId);
    ticketTypeIds.push(input.ticketTypeId);
    sectionNames.push(input.sectionName);
    rowLabels.push(seat.rowLabel);
    seatLabels.push(seat.seatLabel);
    xs.push(seat.x);
    ys.push(seat.y);
    accessibles.push(seat.accessible);
    companions.push(seat.companion);
    prices.push(input.priceMinor);
  }

  await executor.query(
    `INSERT INTO "event_seats"
       ("event_id", "ticket_type_id", "section_name", "row_label",
        "seat_label", "x", "y", "accessible", "companion", "price_minor")
     SELECT * FROM unnest(
       $1::uuid[], $2::uuid[], $3::varchar[], $4::varchar[], $5::varchar[],
       $6::int[], $7::int[], $8::boolean[], $9::boolean[], $10::int[]
     )`,
    [
      eventIds,
      ticketTypeIds,
      sectionNames,
      rowLabels,
      seatLabels,
      xs,
      ys,
      accessibles,
      companions,
      prices,
    ]
  );
}

// null means claim no longer draft
export async function markEventPublished(
  executor: DatabaseExecutor,
  input: { eventId: string; organizationId: string }
): Promise<EventRow | null> {
  const result = await executor.query<EventRow>(
    `UPDATE "events"
     SET "status" = 'published',
         "published_at" = CURRENT_TIMESTAMP,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2 AND "status" = 'draft'
     RETURNING ${eventColumns}`,
    [input.eventId, input.organizationId]
  );
  return result.rows[0] ?? null;
}
