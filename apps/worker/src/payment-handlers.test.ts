import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { OutboxEvent } from "@event-ticketing/database";
import { createFakePaymentGateway } from "@event-ticketing/payments";

import type { AuthEmailMessage } from "./mailer.js";
import { OutboxHandlerError } from "./outbox-processor.js";
import {
  createPaymentHandlers,
  PAYMENT_COMPENSATION_TOPIC,
  PAYMENT_FAILED_TOPIC,
  PAYMENT_SUCCEEDED_TOPIC,
} from "./payment-handlers.js";

function makeEvent(topic: string, payload: unknown): OutboxEvent {
  return {
    aggregateId: null,
    aggregateType: null,
    attemptCount: 1,
    availableAt: new Date(),
    id: "11111111-1111-4111-8111-111111111111",
    maxAttempts: 8,
    payload,
    topic,
  };
}

function makeHandlers(pool: Pool, sent: AuthEmailMessage[] = []) {
  return createPaymentHandlers({
    emailer: {
      async send(message) {
        sent.push(message);
      },
    },
    gateway: createFakePaymentGateway(),
    opsAlertEmail: "ops@example.test",
    pool,
  });
}

const handlerContext = {
  eventId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  workerId: "test",
};

describe("payment handler payload validation", () => {
  it("rejects malformed webhook payloads before touching the database", async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const handlers = makeHandlers(pool);

    for (const topic of [PAYMENT_SUCCEEDED_TOPIC, PAYMENT_FAILED_TOPIC]) {
      for (const payload of [
        null,
        {},
        { providerPaymentIntentId: "pi_1" },
        {
          amountMinor: "42",
          currency: "USD",
          providerPaymentIntentId: "pi_1",
          webhookEventId: "w",
        },
      ]) {
        await expect(
          handlers[topic]!(makeEvent(topic, payload), handlerContext)
        ).rejects.toBeInstanceOf(OutboxHandlerError);
      }
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a compensation event without an order id", async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const handlers = makeHandlers(pool);

    await expect(
      handlers[PAYMENT_COMPENSATION_TOPIC]!(
        makeEvent(PAYMENT_COMPENSATION_TOPIC, {}),
        handlerContext
      )
    ).rejects.toBeInstanceOf(OutboxHandlerError);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("compensation handler", () => {
  const orderId = "22222222-2222-4222-8222-222222222222";

  function poolReturning(target: Record<string, unknown>): Pool {
    return {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [target] }),
    } as unknown as Pool;
  }

  it("short-circuits when the payment is already refunded", async () => {
    const sent: AuthEmailMessage[] = [];
    const pool = poolReturning({
      amountMinor: 4_200,
      currency: "USD",
      orderId,
      orderStatus: "refunded",
      paymentStatus: "refunded",
      providerPaymentIntentId: "pi_1",
      publicNumber: "ET-TEST",
      userId: null,
    });
    const handlers = makeHandlers(pool, sent);

    await handlers[PAYMENT_COMPENSATION_TOPIC]!(
      makeEvent(PAYMENT_COMPENSATION_TOPIC, { orderId }),
      handlerContext
    );
    expect(sent).toHaveLength(0);
  });

  it("fails loudly when the order has no provider reference", async () => {
    const pool = poolReturning({
      amountMinor: 4_200,
      currency: "USD",
      orderId,
      orderStatus: "payment_conflict",
      paymentStatus: "succeeded",
      providerPaymentIntentId: null,
      publicNumber: "ET-TEST",
      userId: null,
    });
    const handlers = makeHandlers(pool);

    await expect(
      handlers[PAYMENT_COMPENSATION_TOPIC]!(
        makeEvent(PAYMENT_COMPENSATION_TOPIC, { orderId }),
        handlerContext
      )
    ).rejects.toBeInstanceOf(OutboxHandlerError);
  });
});
