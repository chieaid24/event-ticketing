import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  createDatabasePool,
  listTicketsForActor,
  loadTicketForActor,
  rotateTicketQrToken,
  withDatabaseTransaction,
  type OrderActor,
  type RotateTicketOutcome,
  type TicketAccessRecord,
} from "@event-ticketing/database";

export interface TicketsStore {
  listTickets(actor: OrderActor): Promise<TicketAccessRecord[]>;
  loadTicket(input: {
    actor: OrderActor;
    ticketId: string;
  }): Promise<TicketAccessRecord>;
  rotateQr(input: {
    actor: OrderActor;
    ticketId: string;
    tokenHash: string;
  }): Promise<RotateTicketOutcome>;
}

export class PgTicketsStore implements TicketsStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async listTickets(actor: OrderActor): Promise<TicketAccessRecord[]> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      listTicketsForActor(transaction, { actor })
    );
  }

  async loadTicket(input: {
    actor: OrderActor;
    ticketId: string;
  }): Promise<TicketAccessRecord> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      loadTicketForActor(transaction, input)
    );
  }

  async rotateQr(input: {
    actor: OrderActor;
    ticketId: string;
    tokenHash: string;
  }): Promise<RotateTicketOutcome> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      rotateTicketQrToken(transaction, input)
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
