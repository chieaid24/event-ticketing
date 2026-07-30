import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import type { OutboxEvent } from "@event-ticketing/database";
import { createFakePaymentGateway } from "@event-ticketing/payments";

import { PermanentEmailError, type AuthEmailMessage } from "./mailer.js";
import { OutboxHandlerError } from "./outbox-processor.js";
import {
  createRefundHandlers,
  NOTIFICATION_SEND_TOPIC,
  REFUND_SUCCEEDED_TOPIC,
} from "./refund-handlers.js";

const notificationId = "11111111-1111-4111-8111-111111111111";

function makeEvent(payload: unknown): OutboxEvent {
  return {
    aggregateId: notificationId,
    aggregateType: "notification",
    attemptCount: 1,
    availableAt: new Date(),
    id: "22222222-2222-4222-8222-222222222222",
    maxAttempts: 8,
    payload,
    topic: NOTIFICATION_SEND_TOPIC,
  };
}

function notificationPool(email: string): {
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM "notifications"')) {
      return {
        rowCount: 1,
        rows: [
          {
            attemptCount: 0,
            id: notificationId,
            kind: "refund_confirmation",
            payload: { subject: "Refund confirmed", text: "Refund body" },
            recipientEmail: email,
            status: "queued",
          },
        ],
      };
    }
    return { rowCount: 1, rows: [] };
  });
  return { pool: { query } as unknown as Pool, query };
}

describe("notification handler", () => {
  it("marks a successfully sent notification once", async () => {
    const sent: AuthEmailMessage[] = [];
    const { pool, query } = notificationPool("customer@example.test");
    const handlers = createRefundHandlers({
      emailer: {
        async send(message) {
          sent.push(message);
        },
      },
      gateway: createFakePaymentGateway(),
      pool,
    });

    await handlers[NOTIFICATION_SEND_TOPIC]!(makeEvent({ notificationId }), {
      eventId: "event",
      idempotencyKey: "key",
    });
    expect(sent).toEqual([
      {
        subject: "Refund confirmed",
        text: "Refund body",
        to: "customer@example.test",
      },
    ]);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes(`"status" = 'sent'`)
      )
    ).toBe(true);
  });

  it("records a transient failure and lets the outbox retry", async () => {
    const { pool, query } = notificationPool("customer@example.test");
    const handlers = createRefundHandlers({
      emailer: {
        async send() {
          throw new Error("temporary");
        },
      },
      gateway: createFakePaymentGateway(),
      pool,
    });

    await expect(
      handlers[NOTIFICATION_SEND_TOPIC]!(makeEvent({ notificationId }), {
        eventId: "event",
        idempotencyKey: "key",
      })
    ).rejects.toBeInstanceOf(OutboxHandlerError);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes(`"status" = 'failed'`)
      )
    ).toBe(true);
  });

  it("suppresses a permanent recipient rejection", async () => {
    const { pool, query } = notificationPool("customer@example.test");
    const handlers = createRefundHandlers({
      emailer: {
        async send() {
          throw new PermanentEmailError();
        },
      },
      gateway: createFakePaymentGateway(),
      pool,
    });

    await expect(
      handlers[NOTIFICATION_SEND_TOPIC]!(makeEvent({ notificationId }), {
        eventId: "event",
        idempotencyKey: "key",
      })
    ).resolves.toBeUndefined();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes(`"status" = 'suppressed'`)
      )
    ).toBe(true);
  });
});

describe("refund webhook handler", () => {
  it("rejects a refund event without its payment intent", async () => {
    const { pool } = notificationPool("customer@example.test");
    const handlers = createRefundHandlers({
      emailer: { async send() {} },
      gateway: createFakePaymentGateway(),
      pool,
    });

    await expect(
      handlers[REFUND_SUCCEEDED_TOPIC]!(
        makeEvent({
          amountMinor: 1200,
          currency: "USD",
          providerRefundId: "re_1",
          refundId: "refund-1",
          webhookEventId: "webhook-1",
        }),
        {
          eventId: "event",
          idempotencyKey: "key",
        }
      )
    ).rejects.toMatchObject({ code: "invalid_event_payload" });
  });
});
