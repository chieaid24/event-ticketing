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
  /** Outbox event enqueued only for a first delivery of a handled type. */
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
    // A transaction keeps the multi-query summary reading one snapshot.
    return withDatabaseTransaction(this.pool, (transaction) =>
      loadOrderForActor(transaction, input)
    );
  }

  async ingestWebhookEvent(
    input: WebhookIngestInput
  ): Promise<WebhookEventRecord> {
    return withDatabaseTransaction(this.pool, async (transaction) => {
      const record = await recordWebhookEvent(transaction, input);
      // The receipt and the processing request commit atomically; outbox
      // deduplication additionally guards a lost race on the receipt.
      if (!record.replayed && input.enqueue) {
        await enqueueOutboxEvent(transaction, {
          deduplicationKey: input.enqueue.deduplicationKey,
          payload: input.enqueue.payload,
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
