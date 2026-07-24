import { describe, expect, it, vi } from "vitest";

import { createWorkerRuntime } from "./runtime.js";

describe("worker runtime", () => {
  it("starts once and stops cleanly", async () => {
    const log = vi.fn();
    const runtime = createWorkerRuntime(log);

    runtime.start();
    runtime.start();
    await runtime.stop();

    expect(log.mock.calls).toEqual([
      [{ event: "worker.started", service: "worker" }],
      [{ event: "worker.stopped", service: "worker" }],
    ]);
  });
});
