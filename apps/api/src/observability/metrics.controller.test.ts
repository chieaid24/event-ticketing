import { describe, expect, it } from "vitest";

import { HttpMetrics } from "./http-metrics.js";
import { MetricsController } from "./metrics.controller.js";

describe("MetricsController", () => {
  it("exports HTTP and outbox metrics without job payloads", async () => {
    const http = new HttpMetrics();
    http.record({
      durationSeconds: 0.1,
      method: "GET",
      path: "/health/ready",
      statusCode: 200,
    });
    const controller = new MetricsController(http, {
      outboxMetrics: async () => ({
        deadLetter: 2,
        oldestReadyAgeSeconds: 12,
        pendingDelayed: 3,
        pendingReady: 4,
        processing: 1,
        retrying: 1,
      }),
    } as never);
    const output = await controller.get();
    expect(output).toContain(
      'event_ticketing_outbox_jobs{state="dead_letter"} 2'
    );
    expect(output).toContain(
      "event_ticketing_outbox_oldest_ready_age_seconds 12"
    );
    expect(output).not.toContain("payload");
  });
});
