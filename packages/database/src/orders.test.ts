import { describe, expect, it, vi } from "vitest";

import {
  attachPaymentIntent,
  createOrderForHold,
  generateOrderPublicNumber,
  OrderInputError,
  OrderStateError,
  recordWebhookEvent,
  type DatabaseExecutor,
} from "./index.js";

const holdId = "44444444-4444-4444-8444-444444444444";
const userId = "22222222-2222-4222-8222-222222222222";

describe("createOrderForHold input", () => {
  it("requires exactly one actor before querying PostgreSQL", async () => {
    const executor: DatabaseExecutor = { query: vi.fn() };

    for (const actor of [{}, { userId, guestSessionId: "guest-1" }]) {
      await expect(
        createOrderForHold(executor, { actor, holdId, provider: "fake" })
      ).rejects.toBeInstanceOf(OrderInputError);
    }
    expect(executor.query).not.toHaveBeenCalled();
  });
});

describe("generateOrderPublicNumber", () => {
  it("produces bounded, prefixed, unambiguous identifiers", () => {
    for (let i = 0; i < 200; i += 1) {
      const publicNumber = generateOrderPublicNumber();
      expect(publicNumber).toMatch(/^ET-[0-9A-HJKMNP-TV-Z]{12}$/);
      expect(publicNumber.length).toBeLessThanOrEqual(20);
    }
  });

  it("does not repeat across a small sample", () => {
    const sample = new Set(
      Array.from({ length: 500 }, () => generateOrderPublicNumber())
    );
    expect(sample.size).toBe(500);
  });
});

describe("attachPaymentIntent", () => {
  it("rejects replacing an order's existing intent with a different one", async () => {
    const executor: DatabaseExecutor = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };

    await expect(
      attachPaymentIntent(executor, {
        clientSecret: "pi_secret",
        orderId: "55555555-5555-4555-8555-555555555555",
        providerPaymentIntentId: "pi_other",
      })
    ).rejects.toBeInstanceOf(OrderStateError);
  });
});

describe("recordWebhookEvent", () => {
  it("replays the original row for a duplicate delivery", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: "66666666-6666-4666-8666-666666666666" }],
      });
    const executor: DatabaseExecutor = { query };

    const record = await recordWebhookEvent(executor, {
      payload: { id: "evt_1" },
      provider: "stripe",
      providerEventId: "evt_1",
      type: "payment_intent.succeeded",
    });

    expect(record.replayed).toBe(true);
    expect(record.id).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("returns a fresh record for a first delivery", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: "77777777-7777-4777-8777-777777777777" }],
    });
    const executor: DatabaseExecutor = { query };

    const record = await recordWebhookEvent(executor, {
      payload: { id: "evt_2" },
      provider: "stripe",
      providerEventId: "evt_2",
      type: "payment_intent.payment_failed",
    });

    expect(record.replayed).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
