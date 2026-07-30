import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  checkInTicket,
  createDatabasePool,
  findEventById,
  findMembershipByUser,
  findOrganizationById,
  listRecentScans,
  reverseCheckIn,
  withDatabaseTransaction,
  type CheckInInput,
  type CheckInOutcome,
  type EventRow,
  type MembershipRow,
  type OrganizationRow,
  type ReverseCheckInInput,
  type ReverseCheckInOutcome,
  type ScanActivityRecord,
} from "@event-ticketing/database";

export interface ScanningStore {
  checkIn(input: CheckInInput): Promise<CheckInOutcome>;
  findEvent(input: {
    eventId: string;
    organizationId: string;
  }): Promise<EventRow | null>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null>;
  findOrganization(organizationId: string): Promise<OrganizationRow | null>;
  recentScans(input: {
    eventId: string;
    limit: number;
    organizationId: string;
  }): Promise<ScanActivityRecord[]>;
  reverse(input: ReverseCheckInInput): Promise<ReverseCheckInOutcome>;
}

export class PgScanningStore implements ScanningStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async checkIn(input: CheckInInput): Promise<CheckInOutcome> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      checkInTicket(transaction, input)
    );
  }

  async findEvent(input: {
    eventId: string;
    organizationId: string;
  }): Promise<EventRow | null> {
    return findEventById(this.pool, input);
  }

  async findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null> {
    return findMembershipByUser(this.pool, input);
  }

  async findOrganization(
    organizationId: string
  ): Promise<OrganizationRow | null> {
    return findOrganizationById(this.pool, organizationId);
  }

  async recentScans(input: {
    eventId: string;
    limit: number;
    organizationId: string;
  }): Promise<ScanActivityRecord[]> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      listRecentScans(transaction, input)
    );
  }

  async reverse(input: ReverseCheckInInput): Promise<ReverseCheckInOutcome> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      reverseCheckIn(transaction, input)
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
