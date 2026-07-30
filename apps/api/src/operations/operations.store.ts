import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  createDatabasePool,
  createOutboxRepository,
  findMembershipByUser,
  findOrganizationById,
  getOrganizationAnalytics,
  listOrganizationJobs,
  listPlatformJobs,
  retryOperationsJob,
  type MembershipRow,
  type OperationsJobRow,
  type OrganizationAnalyticsRows,
  type OrganizationRow,
  type OutboxMetrics,
  type RetryJobResult,
} from "@event-ticketing/database";

export interface OperationsStore {
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null>;
  findOrganization(organizationId: string): Promise<OrganizationRow | null>;
  getAnalytics(input: {
    from: string;
    organizationId: string;
    to: string;
  }): Promise<OrganizationAnalyticsRows>;
  listOrganizationJobs(organizationId: string): Promise<OperationsJobRow[]>;
  listPlatformJobs(): Promise<OperationsJobRow[]>;
  outboxMetrics(): Promise<OutboxMetrics>;
  retryJob(input: {
    actorUserId: string;
    expectedUpdatedAt: Date;
    jobId: string;
    organizationId?: string;
  }): Promise<RetryJobResult>;
}

export class PgOperationsStore
  implements OperationsStore, OnApplicationShutdown
{
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
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

  async getAnalytics(input: {
    from: string;
    organizationId: string;
    to: string;
  }): Promise<OrganizationAnalyticsRows> {
    return getOrganizationAnalytics(this.pool, input);
  }

  async listOrganizationJobs(
    organizationId: string
  ): Promise<OperationsJobRow[]> {
    return listOrganizationJobs(this.pool, {
      limit: 100,
      organizationId,
    });
  }

  async listPlatformJobs(): Promise<OperationsJobRow[]> {
    return listPlatformJobs(this.pool, 100);
  }

  async outboxMetrics(): Promise<OutboxMetrics> {
    return createOutboxRepository(this.pool).metrics();
  }

  async retryJob(input: {
    actorUserId: string;
    expectedUpdatedAt: Date;
    jobId: string;
    organizationId?: string;
  }): Promise<RetryJobResult> {
    return retryOperationsJob(this.pool, input);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
