import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  attachPaymentIntent,
  createDatabasePool,
  createOrderForHold,
  enqueueOutboxEvent,
  loadOrderForActor,
  recordWebhookEvent,
  withDatabaseTransaction,
  type CreateOrderForHoldInput,
  type OrderActor,
  type OrderRecord,
  type RecordWebhookEventInput,
  type WebhookEventRecord,
} from "@event-ticketing/database";

export interface WebhookIngestInput extends RecordWebhookEventInput {
  // enqueued only on first delivery of a handled type
  enqueue: {
    deduplicationKey: string;
    payload: Record<string, unknown>;
    topic: string;
  } | null;
}

export interface CheckoutStore {
  attachIntent(input: {
    clientSecret: string;
    orderId: string;
    providerPaymentIntentId: string;
  }): Promise<void>;
  createOrder(input: CreateOrderForHoldInput): Promise<OrderRecord>;
  ingestWebhookEvent(input: WebhookIngestInput): Promise<WebhookEventRecord>;
  loadOrder(input: {
    actor: OrderActor;
    orderId: string;
  }): Promise<OrderRecord>;
}

export class PgCheckoutStore implements CheckoutStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async createOrder(input: CreateOrderForHoldInput): Promise<OrderRecord> {
    return withDatabaseTransaction(this.pool, (transaction) =>
      createOrderForHold(transaction, input)
    );
  }

  async attachIntent(input: {
    clientSecret: string;
    orderId: string;
    providerPaymentIntentId: string;
  }): Promise<void> {
    await withDatabaseTransaction(this.pool, (transaction) =>
      attachPaymentIntent(transaction, input)
    );
  }

  async loadOrder(input: {
    actor: OrderActor;
    orderId: string;
  }): Promise<OrderRecord> {
    // transaction keeps multi-query read on one snapshot
    return withDatabaseTransaction(this.pool, (transaction) =>
      loadOrderForActor(transaction, input)
    );
  }

  async ingestWebhookEvent(
    input: WebhookIngestInput
  ): Promise<WebhookEventRecord> {
    return withDatabaseTransaction(this.pool, async (transaction) => {
      const record = await recordWebhookEvent(transaction, input);
      // receipt and processing commit together
      if (!record.replayed && input.enqueue) {
        await enqueueOutboxEvent(transaction, {
          deduplicationKey: input.enqueue.deduplicationKey,
          payload: { ...input.enqueue.payload, webhookEventId: record.id },
          topic: input.enqueue.topic,
        });
      }
      return record;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
