import { afterEach, describe, expect, it, vi } from "vitest";

import type { OutboxCycleResult } from "./outbox-processor.js";
import { createWorkerRuntime } from "./runtime.js";

const cycleResult: OutboxCycleResult = {
  claimed: 0,
  completed: 0,
  deadLettered: 0,
  materialized: 0,
  metrics: {
    deadLetter: 0,
    oldestReadyAgeSeconds: 0,
    pendingDelayed: 0,
    pendingReady: 0,
    processing: 0,
    retrying: 0,
  },
  retried: 0,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("worker runtime", () => {
  it("starts once and stops the processor cleanly", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const processor = {
      processOnce: vi.fn().mockResolvedValue(cycleResult),
      stop: vi.fn().mockResolvedValue(0),
    };
    const runtime = createWorkerRuntime({
      log,
      pollIntervalMs: 1_000,
      processor,
    });

    runtime.start();
    runtime.start();
    await runtime.stop();

    expect(processor.processOnce).not.toHaveBeenCalled();
    expect(processor.stop).toHaveBeenCalledOnce();
    expect(log.mock.calls).toEqual([
      [{ event: "worker.started", service: "worker" }],
      [{ event: "worker.stopped", service: "worker" }],
    ]);
  });

  it("reports cycle metrics without event payloads", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const processor = {
      processOnce: vi.fn().mockResolvedValue(cycleResult),
      stop: vi.fn().mockResolvedValue(0),
    };
    const runtime = createWorkerRuntime({
      log,
      pollIntervalMs: 1_000,
      processor,
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await runtime.stop();

    expect(log).toHaveBeenCalledWith({
      event: "outbox.cycle.completed",
      service: "worker",
      ...cycleResult,
    });
  });

  it("does not repeat unchanged idle metrics", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const processor = {
      processOnce: vi.fn().mockResolvedValue(cycleResult),
      stop: vi.fn().mockResolvedValue(0),
    };
    const runtime = createWorkerRuntime({
      log,
      pollIntervalMs: 1_000,
      processor,
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await runtime.stop();

    expect(processor.processOnce).toHaveBeenCalledTimes(2);
    expect(
      log.mock.calls.filter(
        ([entry]) => entry.event === "outbox.cycle.completed"
      )
    ).toHaveLength(1);
  });

  it("reports a safe code when a cycle fails", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const processor = {
      processOnce: vi.fn().mockRejectedValue(new Error("secret detail")),
      stop: vi.fn().mockResolvedValue(0),
    };
    const runtime = createWorkerRuntime({
      log,
      pollIntervalMs: 1_000,
      processor,
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await runtime.stop();

    expect(log).toHaveBeenCalledWith({
      errorCode: "outbox_cycle_failed",
      event: "outbox.cycle.failed",
      service: "worker",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail");
  });
});
