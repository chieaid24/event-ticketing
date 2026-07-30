import type { QueryResultRow } from "pg";

import { insertAuditLog } from "./organizations.js";
import type { DatabaseExecutor } from "./outbox.js";
import type { TicketStatus } from "./tickets.js";

export type ScanResult =
  | "accepted"
  | "duplicate"
  | "wrong_event"
  | "refunded"
  | "void"
  | "expired"
  | "invalid"
  | "reversed";

/** The ticket as scanner staff may see it after a validation attempt. */
export interface ScanTicketDetail {
  checkedInAt: Date | null;
  /** The ticket's own event title, which differs on a wrong_event result. */
  eventTitle: string;
  publicNumber: string;
  rowLabel: string | null;
  seatLabel: string | null;
  sectionName: string | null;
  ticketId: string;
  ticketTypeName: string;
}

/** How the scanner identified the ticket; raw QR bearers never reach here. */
export type ScanCredential =
  | { kind: "qr"; tokenHash: string }
  | { kind: "public_number"; publicNumber: string };

export interface CheckInInput {
  actorUserId: string;
  credential: ScanCredential;
  deviceId: string;
  eventId: string;
  organizationId: string;
}

export interface CheckInOutcome {
  result: Exclude<ScanResult, "reversed">;
  scanId: string;
  /** Null exactly when the result is invalid. */
  ticket: ScanTicketDetail | null;
}

export interface ReverseCheckInInput {
  actorUserId: string;
  deviceId: string;
  eventId: string;
  organizationId: string;
  reason: string;
  ticketId: string;
}

export type ReverseCheckInOutcome =
  | { outcome: "reversed"; scanId: string; ticket: ScanTicketDetail }
  /** The ticket is not visible to this organization and event. */
  | { outcome: "not_found" }
  | { outcome: "not_checked_in"; status: TicketStatus };

/** One row of an event's recent scan activity, newest first. */
export interface ScanActivityRecord {
  actorEmail: string | null;
  createdAt: Date;
  id: string;
  reason: string | null;
  result: ScanResult;
  ticketId: string | null;
  ticketPublicNumber: string | null;
}

interface LockedTicketRow extends QueryResultRow {
  checkedInAt: Date | null;
  eventEnded: boolean;
  eventTitle: string;
  organizationId: string;
  publicNumber: string;
  rowLabel: string | null;
  seatLabel: string | null;
  sectionName: string | null;
  status: TicketStatus;
  ticketEventId: string;
  ticketId: string;
  ticketTypeName: string;
}

const lockedTicketSelect = `
  SELECT
    tk."id" AS "ticketId",
    tk."status",
    tk."checked_in_at" AS "checkedInAt",
    tk."public_number" AS "publicNumber",
    tk."event_id" AS "ticketEventId",
    e."organization_id" AS "organizationId",
    e."title" AS "eventTitle",
    (e."ends_at" IS NOT NULL AND e."ends_at" < CURRENT_TIMESTAMP)
      AS "eventEnded",
    t."name" AS "ticketTypeName",
    s."section_name" AS "sectionName",
    s."row_label" AS "rowLabel",
    s."seat_label" AS "seatLabel"
  FROM "tickets" tk
  JOIN "events" e ON e."id" = tk."event_id"
  JOIN "ticket_types" t ON t."id" = tk."ticket_type_id"
  LEFT JOIN "event_seats" s ON s."id" = tk."event_seat_id"
`;

// Locks only the ticket row; the outer-joined seat cannot take FOR UPDATE.
const lockClause = `FOR UPDATE OF tk`;

/**
 * Records one validation attempt and, when the ticket is eligible, performs
 * the atomic check-in: the ticket row is locked with FOR UPDATE, its state is
 * re-read under the lock, and the transition plus the scan row plus the audit
 * entry commit together. Concurrent scans of the same ticket serialize on the
 * row lock, so exactly one attempt returns accepted.
 *
 * Every attempt appends a scan row, including failures. A credential that
 * matches no ticket, or a ticket belonging to another organization, records
 * an invalid result with no ticket reference so scan history never leaks
 * another tenant's data.
 */
export async function checkInTicket(
  executor: DatabaseExecutor,
  input: CheckInInput
): Promise<CheckInOutcome> {
  const byQr = input.credential.kind === "qr";
  const lookupValue =
    input.credential.kind === "qr"
      ? input.credential.tokenHash
      : input.credential.publicNumber;
  const found = await executor.query<LockedTicketRow>(
    `${lockedTicketSelect}
     WHERE ${byQr ? `tk."qr_token_hash" = $1` : `tk."public_number" = $1`}
     ${lockClause}`,
    [lookupValue]
  );
  const row = found.rows[0];

  if (!row || row.organizationId !== input.organizationId) {
    const scanId = await appendScan(executor, input, "invalid", null);
    return { result: "invalid", scanId, ticket: null };
  }

  const detail = toDetail(row);
  if (row.ticketEventId !== input.eventId) {
    const scanId = await appendScan(executor, input, "wrong_event", row);
    return { result: "wrong_event", scanId, ticket: detail };
  }
  if (row.status === "void" || row.status === "refunded") {
    const scanId = await appendScan(executor, input, row.status, row);
    return { result: row.status, scanId, ticket: detail };
  }
  if (row.status === "checked_in") {
    const scanId = await appendScan(executor, input, "duplicate", row);
    return { result: "duplicate", scanId, ticket: detail };
  }
  if (row.eventEnded) {
    const scanId = await appendScan(executor, input, "expired", row);
    return { result: "expired", scanId, ticket: detail };
  }

  const updated = await executor.query<{ checkedInAt: Date } & QueryResultRow>(
    `UPDATE "tickets"
     SET "status" = 'checked_in', "checked_in_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1
     RETURNING "checked_in_at" AS "checkedInAt"`,
    [row.ticketId]
  );
  const scanId = await appendScan(executor, input, "accepted", row);
  await insertAuditLog(executor, {
    action: "ticket.checked_in",
    actorUserId: input.actorUserId,
    detail: {
      deviceId: input.deviceId,
      eventId: input.eventId,
      publicNumber: row.publicNumber,
      scanId,
    },
    organizationId: input.organizationId,
    targetId: row.ticketId,
    targetType: "ticket",
  });
  return {
    result: "accepted",
    scanId,
    ticket: { ...detail, checkedInAt: updated.rows[0]?.checkedInAt ?? null },
  };
}

/**
 * Reverses an accidental check-in: the locked ticket returns to active while
 * the accepted scan row stays untouched and a reversed row with the stated
 * reason is appended. History is never rewritten. Permission and reason
 * validation happen in the API layer; this function still refuses tickets
 * outside the given organization and event.
 */
export async function reverseCheckIn(
  executor: DatabaseExecutor,
  input: ReverseCheckInInput
): Promise<ReverseCheckInOutcome> {
  const found = await executor.query<LockedTicketRow>(
    `${lockedTicketSelect}
     WHERE tk."id" = $1
     ${lockClause}`,
    [input.ticketId]
  );
  const row = found.rows[0];
  if (
    !row ||
    row.organizationId !== input.organizationId ||
    row.ticketEventId !== input.eventId
  ) {
    return { outcome: "not_found" };
  }
  if (row.status !== "checked_in") {
    return { outcome: "not_checked_in", status: row.status };
  }

  await executor.query(
    `UPDATE "tickets"
     SET "status" = 'active', "checked_in_at" = NULL
     WHERE "id" = $1`,
    [row.ticketId]
  );
  const scanId = await appendScan(executor, input, "reversed", row);
  await insertAuditLog(executor, {
    action: "ticket.checkin_reversed",
    actorUserId: input.actorUserId,
    detail: {
      deviceId: input.deviceId,
      eventId: input.eventId,
      publicNumber: row.publicNumber,
      reason: input.reason,
      scanId,
    },
    organizationId: input.organizationId,
    targetId: row.ticketId,
    targetType: "ticket",
  });
  return {
    outcome: "reversed",
    scanId,
    ticket: { ...toDetail(row), checkedInAt: null },
  };
}

/** Lists an event's most recent scan attempts, newest first. */
export async function listRecentScans(
  executor: DatabaseExecutor,
  input: { eventId: string; limit: number; organizationId: string }
): Promise<ScanActivityRecord[]> {
  const result = await executor.query<ScanActivityRecord & QueryResultRow>(
    `SELECT
       sc."id",
       sc."result",
       sc."reason",
       sc."created_at" AS "createdAt",
       sc."ticket_id" AS "ticketId",
       tk."public_number" AS "ticketPublicNumber",
       u."email" AS "actorEmail"
     FROM "scans" sc
     LEFT JOIN "tickets" tk ON tk."id" = sc."ticket_id"
     LEFT JOIN "users" u ON u."id" = sc."actor_user_id"
     WHERE sc."event_id" = $1 AND sc."organization_id" = $2
     ORDER BY sc."created_at" DESC, sc."id" DESC
     LIMIT $3`,
    [input.eventId, input.organizationId, input.limit]
  );
  return result.rows;
}

async function appendScan(
  executor: DatabaseExecutor,
  input: {
    actorUserId: string;
    deviceId: string;
    eventId: string;
    organizationId: string;
    reason?: string;
  },
  result: ScanResult,
  ticket: { ticketId: string } | null
): Promise<string> {
  const inserted = await executor.query<{ id: string } & QueryResultRow>(
    `INSERT INTO "scans"
       ("organization_id", "event_id", "ticket_id", "actor_user_id",
        "device_id", "result", "reason")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING "id"`,
    [
      input.organizationId,
      input.eventId,
      ticket?.ticketId ?? null,
      input.actorUserId,
      input.deviceId,
      result,
      input.reason ?? null,
    ]
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new Error("The scan insert returned no row.");
  }
  return row.id;
}

function toDetail(row: LockedTicketRow): ScanTicketDetail {
  return {
    checkedInAt: row.checkedInAt,
    eventTitle: row.eventTitle,
    publicNumber: row.publicNumber,
    rowLabel: row.rowLabel,
    seatLabel: row.seatLabel,
    sectionName: row.sectionName,
    ticketId: row.ticketId,
    ticketTypeName: row.ticketTypeName,
  };
}
