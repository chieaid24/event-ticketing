import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  createDatabasePool,
  createRefund,
  findMembershipByUser,
  findOrganizationById,
  insertAuditLog,
  listRefundsForCustomer,
  withDatabaseTransaction,
  type MembershipRow,
  type OrganizationRow,
  type RefundItemInput,
  type RefundRecord,
} from "@event-ticketing/database";

export interface RefundsStore {
  createCustomerRefund(input: {
    idempotencyKey: string;
    items: RefundItemInput[];
    orderId: string;
    userId: string;
  }): Promise<RefundRecord>;
  createOrganizerRefund(input: {
    actorUserId: string;
    idempotencyKey: string;
    items: RefundItemInput[];
    orderId: string;
    organizationId: string;
    reason: string;
  }): Promise<RefundRecord>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null>;
  findOrganization(organizationId: string): Promise<OrganizationRow | null>;
  listCustomerRefunds(input: {
    orderId: string;
    userId: string;
  }): Promise<RefundRecord[]>;
}

export class PgRefundsStore implements RefundsStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async createCustomerRefund(input: {
    idempotencyKey: string;
    items: RefundItemInput[];
    orderId: string;
    userId: string;
  }): Promise<RefundRecord> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      createRefund(transaction, {
        actorUserId: input.userId,
        idempotencyKey: input.idempotencyKey,
        initiator: "customer",
        items: input.items,
        orderId: input.orderId,
      })
    );
  }

  async createOrganizerRefund(input: {
    actorUserId: string;
    idempotencyKey: string;
    items: RefundItemInput[];
    orderId: string;
    organizationId: string;
    reason: string;
  }): Promise<RefundRecord> {
    return withDatabaseTransaction(this.pool, async (transaction) => {
      const refund = await createRefund(transaction, {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        initiator: "organizer",
        items: input.items,
        orderId: input.orderId,
        organizationId: input.organizationId,
        reason: input.reason,
      });
      await insertAuditLog(transaction, {
        action: "refund.requested",
        actorUserId: input.actorUserId,
        detail: {
          amountMinor: refund.amountMinor,
          orderId: input.orderId,
          reason: input.reason,
        },
        organizationId: input.organizationId,
        targetId: refund.id,
        targetType: "refund",
      });
      return refund;
    });
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

  async listCustomerRefunds(input: {
    orderId: string;
    userId: string;
  }): Promise<RefundRecord[]> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      listRefundsForCustomer(transaction, input)
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
