import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  claimVenueVersion,
  createDatabasePool,
  deleteVenueById,
  fetchVenueLayout,
  findMembershipByUser,
  findOrganizationById,
  findVenueById,
  insertAuditLog,
  insertVenue,
  listVenuesForOrganization,
  replaceVenueLayout,
  updateVenueDetails,
  withDatabaseTransaction,
  type MembershipRow,
  type OrganizationRow,
  type VenueLayoutSectionData,
  type VenueRow,
  type VenueSummaryRow,
} from "@event-ticketing/database";

export type CreateVenueResult = VenueRow | "name_taken";

export type UpdateVenueResult = VenueRow | "version_conflict" | "name_taken";

export type ReplaceLayoutResult = VenueRow | "version_conflict";

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export interface VenuesStore {
  createVenue(input: {
    actorUserId: string;
    description: string | null;
    name: string;
    organizationId: string;
  }): Promise<CreateVenueResult>;
  deleteVenue(input: {
    actorUserId: string;
    organizationId: string;
    venueId: string;
  }): Promise<boolean>;
  fetchLayout(venueId: string): Promise<VenueLayoutSectionData[]>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null>;
  findOrganization(organizationId: string): Promise<OrganizationRow | null>;
  findVenue(input: {
    organizationId: string;
    venueId: string;
  }): Promise<VenueRow | null>;
  listVenues(organizationId: string): Promise<VenueSummaryRow[]>;
  replaceLayout(input: {
    actorUserId: string;
    expectedVersion: number;
    organizationId: string;
    sections: VenueLayoutSectionData[];
    venueId: string;
  }): Promise<ReplaceLayoutResult>;
  updateVenue(input: {
    actorUserId: string;
    description: string | null;
    expectedVersion: number;
    name: string;
    organizationId: string;
    venueId: string;
  }): Promise<UpdateVenueResult>;
}

export class PgVenuesStore implements VenuesStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async findOrganization(
    organizationId: string
  ): Promise<OrganizationRow | null> {
    return findOrganizationById(this.pool, organizationId);
  }

  async findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null> {
    return findMembershipByUser(this.pool, input);
  }

  async findVenue(input: {
    organizationId: string;
    venueId: string;
  }): Promise<VenueRow | null> {
    return findVenueById(this.pool, input);
  }

  async listVenues(organizationId: string): Promise<VenueSummaryRow[]> {
    return listVenuesForOrganization(this.pool, organizationId);
  }

  async fetchLayout(venueId: string): Promise<VenueLayoutSectionData[]> {
    return fetchVenueLayout(this.pool, venueId);
  }

  async createVenue(input: {
    actorUserId: string;
    description: string | null;
    name: string;
    organizationId: string;
  }): Promise<CreateVenueResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const venue = await insertVenue(tx, {
        description: input.description,
        name: input.name,
        organizationId: input.organizationId,
      });
      if (!venue) {
        return "name_taken";
      }

      await insertAuditLog(tx, {
        action: "venue.created",
        actorUserId: input.actorUserId,
        detail: { name: venue.name },
        organizationId: input.organizationId,
        targetId: venue.id,
        targetType: "venue",
      });
      return venue;
    });
  }

  async updateVenue(input: {
    actorUserId: string;
    description: string | null;
    expectedVersion: number;
    name: string;
    organizationId: string;
    venueId: string;
  }): Promise<UpdateVenueResult> {
    try {
      return await withDatabaseTransaction(this.pool, async (tx) => {
        const previous = await findVenueById(tx, {
          organizationId: input.organizationId,
          venueId: input.venueId,
        });
        const updated = previous
          ? await updateVenueDetails(tx, {
              description: input.description,
              expectedVersion: input.expectedVersion,
              name: input.name,
              organizationId: input.organizationId,
              venueId: input.venueId,
            })
          : null;
        if (!previous || !updated) {
          return "version_conflict";
        }

        await insertAuditLog(tx, {
          action: "venue.updated",
          actorUserId: input.actorUserId,
          detail: {
            name: updated.name,
            previousName: previous.name,
            version: updated.version,
          },
          organizationId: input.organizationId,
          targetId: updated.id,
          targetType: "venue",
        });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "name_taken";
      }
      throw error;
    }
  }

  async replaceLayout(input: {
    actorUserId: string;
    expectedVersion: number;
    organizationId: string;
    sections: VenueLayoutSectionData[];
    venueId: string;
  }): Promise<ReplaceLayoutResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      // The CAS bump also locks the venue row, serializing layout writes.
      const venue = await claimVenueVersion(tx, {
        expectedVersion: input.expectedVersion,
        organizationId: input.organizationId,
        venueId: input.venueId,
      });
      if (!venue) {
        return "version_conflict";
      }

      await replaceVenueLayout(tx, {
        sections: input.sections,
        venueId: input.venueId,
      });
      await insertAuditLog(tx, {
        action: "venue.layout.replaced",
        actorUserId: input.actorUserId,
        detail: {
          sectionCount: input.sections.length,
          seatCount: input.sections.reduce(
            (total, section) =>
              total +
              section.rows.reduce((sum, row) => sum + row.seats.length, 0),
            0
          ),
          version: venue.version,
        },
        organizationId: input.organizationId,
        targetId: input.venueId,
        targetType: "venue",
      });
      return venue;
    });
  }

  async deleteVenue(input: {
    actorUserId: string;
    organizationId: string;
    venueId: string;
  }): Promise<boolean> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const venue = await findVenueById(tx, {
        organizationId: input.organizationId,
        venueId: input.venueId,
      });
      if (!venue) {
        return false;
      }

      await insertAuditLog(tx, {
        action: "venue.deleted",
        actorUserId: input.actorUserId,
        detail: { name: venue.name },
        organizationId: input.organizationId,
        targetId: venue.id,
        targetType: "venue",
      });
      return deleteVenueById(tx, {
        organizationId: input.organizationId,
        venueId: input.venueId,
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
