import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "./outbox.js";

export type VenueSectionKind = "assigned" | "general_admission";

export interface VenueRow extends QueryResultRow {
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
  version: number;
}

export interface VenueSummaryRow extends VenueRow {
  accessibleSeatCount: number;
  generalAdmissionCapacity: number;
  seatCount: number;
  sectionCount: number;
}

export interface VenueLayoutSeatData {
  accessible: boolean;
  companion: boolean;
  label: string;
  x: number;
  y: number;
}

export interface VenueLayoutRowData {
  label: string;
  seats: VenueLayoutSeatData[];
}

export interface VenueLayoutSectionData {
  gaCapacity: number | null;
  kind: VenueSectionKind;
  name: string;
  rows: VenueLayoutRowData[];
}

const venueColumns = `
  "id",
  "organization_id" AS "organizationId",
  "name",
  "description",
  "version",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`;

export async function insertVenue(
  executor: DatabaseExecutor,
  input: { description: string | null; name: string; organizationId: string }
): Promise<VenueRow | null> {
  const result = await executor.query<VenueRow>(
    `INSERT INTO "venues" ("organization_id", "name", "description")
     VALUES ($1, $2, $3)
     ON CONFLICT ("organization_id", "name") DO NOTHING
     RETURNING ${venueColumns}`,
    [input.organizationId, input.name, input.description]
  );
  return result.rows[0] ?? null;
}

export async function findVenueById(
  executor: DatabaseExecutor,
  input: { organizationId: string; venueId: string }
): Promise<VenueRow | null> {
  const result = await executor.query<VenueRow>(
    `SELECT ${venueColumns} FROM "venues"
     WHERE "id" = $1 AND "organization_id" = $2`,
    [input.venueId, input.organizationId]
  );
  return result.rows[0] ?? null;
}

export async function listVenuesForOrganization(
  executor: DatabaseExecutor,
  organizationId: string
): Promise<VenueSummaryRow[]> {
  const result = await executor.query<VenueSummaryRow>(
    `SELECT
       v."id",
       v."organization_id" AS "organizationId",
       v."name",
       v."description",
       v."version",
       v."created_at" AS "createdAt",
       v."updated_at" AS "updatedAt",
       (
         SELECT count(*)::int FROM "venue_sections" s
         WHERE s."venue_id" = v."id"
       ) AS "sectionCount",
       (
         SELECT count(*)::int
         FROM "venue_seats" st
         JOIN "venue_rows" r ON r."id" = st."row_id"
         JOIN "venue_sections" s ON s."id" = r."section_id"
         WHERE s."venue_id" = v."id"
       ) AS "seatCount",
       (
         SELECT count(*)::int
         FROM "venue_seats" st
         JOIN "venue_rows" r ON r."id" = st."row_id"
         JOIN "venue_sections" s ON s."id" = r."section_id"
         WHERE s."venue_id" = v."id" AND st."accessible"
       ) AS "accessibleSeatCount",
       (
         SELECT COALESCE(sum(s."ga_capacity"), 0)::int
         FROM "venue_sections" s
         WHERE s."venue_id" = v."id" AND s."ga_capacity" IS NOT NULL
       ) AS "generalAdmissionCapacity"
     FROM "venues" v
     WHERE v."organization_id" = $1
     ORDER BY v."name", v."id"`,
    [organizationId]
  );
  return result.rows;
}

/** Compare-and-swap on version; a null result means a stale update. */
export async function updateVenueDetails(
  executor: DatabaseExecutor,
  input: {
    description: string | null;
    expectedVersion: number;
    name: string;
    organizationId: string;
    venueId: string;
  }
): Promise<VenueRow | null> {
  const result = await executor.query<VenueRow>(
    `UPDATE "venues"
     SET "name" = $3, "description" = $4, "version" = "version" + 1,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2 AND "version" = $5
     RETURNING ${venueColumns}`,
    [
      input.venueId,
      input.organizationId,
      input.name,
      input.description,
      input.expectedVersion,
    ]
  );
  return result.rows[0] ?? null;
}

/** Locks the venue row and bumps its version; null means a stale replace. */
export async function claimVenueVersion(
  executor: DatabaseExecutor,
  input: { expectedVersion: number; organizationId: string; venueId: string }
): Promise<VenueRow | null> {
  const result = await executor.query<VenueRow>(
    `UPDATE "venues"
     SET "version" = "version" + 1, "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "organization_id" = $2 AND "version" = $3
     RETURNING ${venueColumns}`,
    [input.venueId, input.organizationId, input.expectedVersion]
  );
  return result.rows[0] ?? null;
}

export async function deleteVenueById(
  executor: DatabaseExecutor,
  input: { organizationId: string; venueId: string }
): Promise<boolean> {
  const result = await executor.query(
    `DELETE FROM "venues" WHERE "id" = $1 AND "organization_id" = $2`,
    [input.venueId, input.organizationId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Replaces the whole layout inside the caller's transaction. Sections, rows,
 * and seats are template data; events snapshot seats, so replacement never
 * rewrites sold inventory.
 */
export async function replaceVenueLayout(
  executor: DatabaseExecutor,
  input: { sections: VenueLayoutSectionData[]; venueId: string }
): Promise<void> {
  await executor.query(`DELETE FROM "venue_sections" WHERE "venue_id" = $1`, [
    input.venueId,
  ]);

  for (const [sectionIndex, section] of input.sections.entries()) {
    const sectionId = randomUUID();
    await executor.query(
      `INSERT INTO "venue_sections"
         ("id", "venue_id", "name", "kind", "ga_capacity", "position")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sectionId,
        input.venueId,
        section.name,
        section.kind,
        section.gaCapacity,
        sectionIndex,
      ]
    );

    const rowIds: string[] = [];
    const seatRowIds: string[] = [];
    const seatLabels: string[] = [];
    const seatXs: number[] = [];
    const seatYs: number[] = [];
    const seatAccessible: boolean[] = [];
    const seatCompanion: boolean[] = [];
    for (const [rowIndex, row] of section.rows.entries()) {
      const rowId = randomUUID();
      rowIds.push(rowId);
      await executor.query(
        `INSERT INTO "venue_rows" ("id", "section_id", "label", "position")
         VALUES ($1, $2, $3, $4)`,
        [rowId, sectionId, row.label, rowIndex]
      );
      for (const seat of row.seats) {
        seatRowIds.push(rowId);
        seatLabels.push(seat.label);
        seatXs.push(seat.x);
        seatYs.push(seat.y);
        seatAccessible.push(seat.accessible);
        seatCompanion.push(seat.companion);
      }
    }

    if (seatRowIds.length > 0) {
      await executor.query(
        `INSERT INTO "venue_seats"
           ("row_id", "label", "x", "y", "accessible", "companion")
         SELECT * FROM unnest(
           $1::uuid[], $2::varchar[], $3::int[], $4::int[],
           $5::boolean[], $6::boolean[]
         )`,
        [seatRowIds, seatLabels, seatXs, seatYs, seatAccessible, seatCompanion]
      );
    }
  }
}

interface LayoutQueryRow extends QueryResultRow {
  gaCapacity: number | null;
  kind: VenueSectionKind;
  rowLabel: string | null;
  seatAccessible: boolean | null;
  seatCompanion: boolean | null;
  seatLabel: string | null;
  seatX: number | null;
  seatY: number | null;
  sectionId: string;
  sectionName: string;
}

export async function fetchVenueLayout(
  executor: DatabaseExecutor,
  venueId: string
): Promise<VenueLayoutSectionData[]> {
  const result = await executor.query<LayoutQueryRow>(
    `SELECT
       s."id" AS "sectionId",
       s."name" AS "sectionName",
       s."kind",
       s."ga_capacity" AS "gaCapacity",
       r."label" AS "rowLabel",
       st."label" AS "seatLabel",
       st."x" AS "seatX",
       st."y" AS "seatY",
       st."accessible" AS "seatAccessible",
       st."companion" AS "seatCompanion"
     FROM "venue_sections" s
     LEFT JOIN "venue_rows" r ON r."section_id" = s."id"
     LEFT JOIN "venue_seats" st ON st."row_id" = r."id"
     WHERE s."venue_id" = $1
     ORDER BY s."position", r."position", st."x", st."label"`,
    [venueId]
  );

  const sections: VenueLayoutSectionData[] = [];
  const sectionsById = new Map<string, VenueLayoutSectionData>();
  const rowsByKey = new Map<string, VenueLayoutRowData>();
  for (const row of result.rows) {
    let section = sectionsById.get(row.sectionId);
    if (!section) {
      section = {
        gaCapacity: row.gaCapacity,
        kind: row.kind,
        name: row.sectionName,
        rows: [],
      };
      sectionsById.set(row.sectionId, section);
      sections.push(section);
    }
    if (row.rowLabel === null) {
      continue;
    }

    const rowKey = `${row.sectionId}:${row.rowLabel}`;
    let seatingRow = rowsByKey.get(rowKey);
    if (!seatingRow) {
      seatingRow = { label: row.rowLabel, seats: [] };
      rowsByKey.set(rowKey, seatingRow);
      section.rows.push(seatingRow);
    }
    if (row.seatLabel === null) {
      continue;
    }
    seatingRow.seats.push({
      accessible: row.seatAccessible ?? false,
      companion: row.seatCompanion ?? false,
      label: row.seatLabel,
      x: row.seatX ?? 0,
      y: row.seatY ?? 0,
    });
  }
  return sections;
}
