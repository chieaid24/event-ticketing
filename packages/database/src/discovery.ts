import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "./outbox.js";

export type DiscoveryTimeframe = "all" | "past" | "upcoming";

export type AvailabilitySeatDbStatus = "available" | "held" | "sold";

export interface PublishedEventSummaryRow extends QueryResultRow {
  currency: string;
  endsAt: Date;
  id: string;
  mediaUrl: string | null;
  minPriceMinor: number;
  salesEndAt: Date;
  salesStartAt: Date;
  startsAt: Date;
  timezone: string;
  title: string;
  venueName: string;
}

export interface PublishedEventDetailRow extends QueryResultRow {
  currency: string;
  description: string | null;
  endsAt: Date;
  id: string;
  mediaUrl: string | null;
  refundPolicy: string | null;
  salesEndAt: Date;
  salesStartAt: Date;
  startsAt: Date;
  timezone: string;
  title: string;
  venueName: string;
}

export interface PublicTicketTypeRow extends QueryResultRow {
  feeMinor: number;
  id: string;
  kind: "assigned" | "general_admission";
  name: string;
  priceMinor: number;
  sectionName: string;
}

// blocked seats filtered upstream; not public inventory
export interface AvailabilitySeatRow extends QueryResultRow {
  accessible: boolean;
  companion: boolean;
  id: string;
  priceMinor: number;
  rowLabel: string;
  seatLabel: string;
  sectionName: string;
  status: AvailabilitySeatDbStatus;
  x: number;
  y: number;
}

export interface GeneralAdmissionCapacityRow extends QueryResultRow {
  capacity: number;
  feeMinor: number;
  id: string;
  name: string;
  priceMinor: number;
  remaining: number;
}

export interface PublishedEventListInput {
  limit: number;
  offset: number;
  search?: string | undefined;
  timeframe: DiscoveryTimeframe;
}

export interface PublishedEventListResult {
  events: PublishedEventSummaryRow[];
  total: number;
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

const publishedEventFilter = `
  e."status" = 'published'
  AND ($1::text IS NULL
    OR e."title" ILIKE '%' || $1 || '%'
    OR e."description" ILIKE '%' || $1 || '%')
  AND ($2::text = 'all'
    OR ($2::text = 'upcoming' AND e."ends_at" >= CURRENT_TIMESTAMP)
    OR ($2::text = 'past' AND e."ends_at" < CURRENT_TIMESTAMP))
`;

export async function listPublishedEvents(
  executor: DatabaseExecutor,
  input: PublishedEventListInput
): Promise<PublishedEventListResult> {
  const search = input.search ? escapeLikePattern(input.search) : null;

  const totalResult = await executor.query<{ total: number }>(
    `SELECT count(*)::int AS "total"
     FROM "events" e
     WHERE ${publishedEventFilter}`,
    [search, input.timeframe]
  );

  const direction = input.timeframe === "past" ? "DESC" : "ASC";
  const pageResult = await executor.query<PublishedEventSummaryRow>(
    `SELECT
       e."id",
       e."title",
       e."timezone",
       e."currency",
       e."starts_at" AS "startsAt",
       e."ends_at" AS "endsAt",
       e."sales_start_at" AS "salesStartAt",
       e."sales_end_at" AS "salesEndAt",
       e."media_url" AS "mediaUrl",
       v."name" AS "venueName",
       (
         SELECT COALESCE(min(t."price_minor"), 0)::int
         FROM "ticket_types" t
         WHERE t."event_id" = e."id"
       ) AS "minPriceMinor"
     FROM "events" e
     JOIN "venues" v ON v."id" = e."venue_id"
     WHERE ${publishedEventFilter}
     ORDER BY e."starts_at" ${direction}, e."title", e."id"
     LIMIT $3 OFFSET $4`,
    [search, input.timeframe, input.limit, input.offset]
  );

  return { events: pageResult.rows, total: totalResult.rows[0]?.total ?? 0 };
}

export async function findPublishedEventById(
  executor: DatabaseExecutor,
  eventId: string
): Promise<PublishedEventDetailRow | null> {
  const result = await executor.query<PublishedEventDetailRow>(
    `SELECT
       e."id",
       e."title",
       e."description",
       e."timezone",
       e."currency",
       e."starts_at" AS "startsAt",
       e."ends_at" AS "endsAt",
       e."sales_start_at" AS "salesStartAt",
       e."sales_end_at" AS "salesEndAt",
       e."refund_policy" AS "refundPolicy",
       e."media_url" AS "mediaUrl",
       v."name" AS "venueName"
     FROM "events" e
     JOIN "venues" v ON v."id" = e."venue_id"
     WHERE e."id" = $1 AND e."status" = 'published'`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

export async function fetchPublicTicketTypes(
  executor: DatabaseExecutor,
  eventId: string
): Promise<PublicTicketTypeRow[]> {
  const result = await executor.query<PublicTicketTypeRow>(
    `SELECT
       t."id",
       t."name",
       t."kind",
       t."section_name" AS "sectionName",
       t."price_minor" AS "priceMinor",
       t."fee_minor" AS "feeMinor"
     FROM "ticket_types" t
     WHERE t."event_id" = $1
     ORDER BY t."position", t."name"`,
    [eventId]
  );
  return result.rows;
}

export async function fetchAvailabilitySeats(
  executor: DatabaseExecutor,
  eventId: string
): Promise<AvailabilitySeatRow[]> {
  const result = await executor.query<AvailabilitySeatRow>(
    `SELECT
       s."id",
       s."section_name" AS "sectionName",
       s."row_label" AS "rowLabel",
       s."seat_label" AS "seatLabel",
       s."x",
       s."y",
       s."accessible",
       s."companion",
       s."price_minor" AS "priceMinor",
       s."status"
     FROM "event_seats" s
     JOIN "ticket_types" t ON t."id" = s."ticket_type_id"
     WHERE s."event_id" = $1 AND s."status" <> 'blocked'
     ORDER BY t."position", s."section_name", s."y", s."x", s."id"`,
    [eventId]
  );
  return result.rows;
}

// clamp ga remaining until expired holds sweep
export async function fetchGeneralAdmissionCapacity(
  executor: DatabaseExecutor,
  eventId: string
): Promise<GeneralAdmissionCapacityRow[]> {
  const result = await executor.query<GeneralAdmissionCapacityRow>(
    `SELECT
       t."id",
       t."name",
       t."price_minor" AS "priceMinor",
       t."fee_minor" AS "feeMinor",
       COALESCE(t."capacity", 0)::int AS "capacity",
       GREATEST(
         COALESCE(t."capacity", 0) - t."reserved_quantity" - t."sold_quantity",
         0
       )::int AS "remaining"
     FROM "ticket_types" t
     WHERE t."event_id" = $1 AND t."kind" = 'general_admission'
     ORDER BY t."position", t."name"`,
    [eventId]
  );
  return result.rows;
}
