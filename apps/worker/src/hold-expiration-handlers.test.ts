import { describe, expect, it, vi } from "vitest";

import type { OutboxEvent } from "@event-ticketing/database";

import {
  createHoldExpirationHandlers,
  HOLD_EXPIRATION_SWEEP_TOPIC,
} from "./hold-expiration-handlers.js";

const sweepEvent = {
  aggregateId: null,
  aggregateType: null,
  attemptCount: 0,
  availableAt: new Date(),
  id: "00000000-0000-4000-8000-000000000000",
  maxAttempts: 8,
  payload: {},
  topic: HOLD_EXPIRATION_SWEEP_TOPIC,
} satisfies OutboxEvent;

describe("hold expiration handlers", () => {
  it("sweeps due holds with the configured batch limit", async () => {
    const sweep = vi.fn().mockResolvedValue(3);
    const pool = {} as never;
    const handlers = createHoldExpirationHandlers({
      batchLimit: 250,
      pool,
      sweep,
    });

    const handler = handlers[HOLD_EXPIRATION_SWEEP_TOPIC];
    expect(handler).toBeDefined();

    await handler!(sweepEvent, {
      eventId: sweepEvent.id,
      idempotencyKey: sweepEvent.id,
    });

    expect(sweep).toHaveBeenCalledWith(pool, { limit: 250 });
  });
});
