import { describe, expect, it } from "vitest";

import type { OutboxEvent } from "@event-ticketing/database";

import { workerHandlers } from "./handlers.js";
import { OutboxHandlerError } from "./outbox-processor.js";

const context = { eventId: "e-1", idempotencyKey: "e-1", workerId: "test" };

function makeEvent(payload: unknown, aggregateId: string | null): OutboxEvent {
  return {
    aggregateId,
    aggregateType: "event",
    attemptCount: 1,
    availableAt: new Date(),
    id: "e-1",
    maxAttempts: 8,
    payload,
    topic: "event.published",
  };
}

describe("event.published handler", () => {
  it("accepts a payload whose event id matches the aggregate", async () => {
    await expect(
      workerHandlers["event.published"]!(
        makeEvent({ eventId: "ev-1", organizationId: "org-1" }, "ev-1"),
        context
      )
    ).resolves.toBeUndefined();
  });

  it("rejects a payload that disagrees with its aggregate", async () => {
    for (const event of [
      makeEvent({}, "ev-1"),
      makeEvent({ eventId: "ev-2" }, "ev-1"),
      makeEvent(null, "ev-1"),
    ]) {
      await expect(
        workerHandlers["event.published"]!(event, context)
      ).rejects.toBeInstanceOf(OutboxHandlerError);
    }
  });
});
