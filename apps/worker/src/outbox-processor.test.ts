import { describe, expect, it, vi } from "vitest";

import type { OutboxEvent, OutboxMetrics } from "@event-ticketing/database";

import {
  calculateRetryDelayMs,
  createOutboxProcessor,
  OutboxHandlerError,
  type OutboxStore,
} from "./outbox-processor.js";

const event: OutboxEvent = {
  aggregateId: "22222222-2222-4222-8222-222222222222",
  aggregateType: "organization",
  attemptCount: 1,
  availableAt: new Date("2026-01-01T00:00:00.000Z"),
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  maxAttempts: 3,
  payload: {
    organizationId: "22222222-2222-4222-8222-222222222222",
  },
  topic: "organization.created",
};

const metrics: OutboxMetrics = {
  deadLetter: 0,
  oldestReadyAgeSeconds: 0,
  pendingDelayed: 0,
  pendingReady: 0,
  processing: 0,
  retrying: 0,
};

function createStore(overrides: Partial<OutboxStore> = {}): OutboxStore {
  return {
    claimBatch: vi.fn().mockResolvedValue([event]),
    completeEvent: vi.fn().mockResolvedValue(undefined),
    failEvent: vi.fn().mockResolvedValue({
      attemptCount: 1,
      availableAt: new Date(),
      status: "pending",
    }),
    hasHandlerReceipt: vi.fn().mockResolvedValue(false),
    materializeDueSchedules: vi.fn().mockResolvedValue(0),
    metrics: vi.fn().mockResolvedValue(metrics),
    releaseClaims: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("outbox processor", () => {
  it("completes a registered handler with the event idempotency key", async () => {
    const repository = createStore();
    const handler = vi.fn().mockResolvedValue(undefined);
    const processor = createOutboxProcessor({
      batchSize: 10,
      handlers: { "organization.created": handler },
      leaseMs: 30_000,
      repository,
      retryBaseDelayMs: 1_000,
      retryMaximumDelayMs: 60_000,
      workerId: "worker-one",
    });

    await expect(processor.processOnce()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deadLettered: 0,
      materialized: 0,
      metrics,
      retried: 0,
    });
    expect(handler).toHaveBeenCalledWith(event, {
      eventId: event.id,
      idempotencyKey: event.id,
    });
    expect(repository.completeEvent).toHaveBeenCalledWith({
      eventId: event.id,
      handlerName: event.topic,
      workerId: "worker-one",
    });
  });

  it("does not invoke a handler again after a durable receipt", async () => {
    const repository = createStore({
      hasHandlerReceipt: vi.fn().mockResolvedValue(true),
    });
    const handler = vi.fn().mockResolvedValue(undefined);
    const processor = createOutboxProcessor({
      batchSize: 10,
      handlers: { "organization.created": handler },
      leaseMs: 30_000,
      repository,
      retryBaseDelayMs: 1_000,
      retryMaximumDelayMs: 60_000,
      workerId: "worker-one",
    });

    await processor.processOnce();

    expect(handler).not.toHaveBeenCalled();
    expect(repository.completeEvent).toHaveBeenCalledOnce();
  });

  it("retries with a safe code and bounded exponential delay", async () => {
    const repository = createStore();
    const processor = createOutboxProcessor({
      batchSize: 10,
      handlers: {
        "organization.created": async () => {
          throw new OutboxHandlerError("provider_unavailable");
        },
      },
      leaseMs: 30_000,
      repository,
      retryBaseDelayMs: 1_000,
      retryMaximumDelayMs: 60_000,
      workerId: "worker-one",
    });

    await expect(processor.processOnce()).resolves.toMatchObject({
      completed: 0,
      retried: 1,
    });
    expect(repository.failEvent).toHaveBeenCalledWith({
      errorCode: "provider_unavailable",
      eventId: event.id,
      retryDelayMs: 1_000,
      workerId: "worker-one",
    });
  });

  it("uses a generic failure code for unexpected errors", async () => {
    const repository = createStore();
    const processor = createOutboxProcessor({
      batchSize: 10,
      handlers: {
        "organization.created": async () => {
          throw new Error("sensitive provider response");
        },
      },
      leaseMs: 30_000,
      repository,
      retryBaseDelayMs: 1_000,
      retryMaximumDelayMs: 60_000,
      workerId: "worker-one",
    });

    await processor.processOnce();

    expect(repository.failEvent).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "handler_failed" })
    );
  });

  it("uses a generic failure code for an unsafe handler code", async () => {
    const repository = createStore();
    const processor = createOutboxProcessor({
      batchSize: 10,
      handlers: {
        "organization.created": async () => {
          throw new OutboxHandlerError("Provider said: secret detail");
        },
      },
      leaseMs: 30_000,
      repository,
      retryBaseDelayMs: 1_000,
      retryMaximumDelayMs: 60_000,
      workerId: "worker-one",
    });

    await processor.processOnce();

    expect(repository.failEvent).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "handler_failed" })
    );
  });

  it("releases outstanding claims during shutdown", async () => {
    const repository = createStore({
      claimBatch: vi.fn().mockResolvedValue([]),
    });
    const processor = createOutboxProcessor({
      batchSize: 10,
      handlers: {},
      leaseMs: 30_000,
      repository,
      retryBaseDelayMs: 1_000,
      retryMaximumDelayMs: 60_000,
      workerId: "worker-one",
    });

    await expect(processor.stop()).resolves.toBe(0);
    expect(repository.releaseClaims).toHaveBeenCalledWith("worker-one");
  });

  it("releases claims after an active cycle fails", async () => {
    const repository = createStore({
      materializeDueSchedules: vi
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
    });
    const processor = createOutboxProcessor({
      batchSize: 10,
      handlers: {},
      leaseMs: 30_000,
      repository,
      retryBaseDelayMs: 1_000,
      retryMaximumDelayMs: 60_000,
      workerId: "worker-one",
    });

    const cycle = processor.processOnce();

    await expect(processor.stop()).resolves.toBe(0);
    await expect(cycle).rejects.toThrow("database unavailable");
    expect(repository.releaseClaims).toHaveBeenCalledWith("worker-one");
  });
});

describe("calculateRetryDelayMs", () => {
  it("caps exponential delays", () => {
    expect(calculateRetryDelayMs(1, 1_000, 5_000)).toBe(1_000);
    expect(calculateRetryDelayMs(2, 1_000, 5_000)).toBe(2_000);
    expect(calculateRetryDelayMs(10, 1_000, 5_000)).toBe(5_000);
  });
});
