import { describe, expect, it } from "vitest";

import { HttpMetrics, normalizeMetricPath } from "./http-metrics.js";

describe("HTTP metrics", () => {
  it("normalizes identifiers before using paths as labels", () => {
    expect(
      normalizeMetricPath(
        "/organizations/12c4244c-2041-4d01-ae48-1de95616466c/jobs/42"
      )
    ).toBe("/organizations/:id/jobs/:id");
  });

  it("renders counters and duration histograms", () => {
    const metrics = new HttpMetrics();
    metrics.record({
      durationSeconds: 0.025,
      method: "GET",
      path: "/health/ready",
      statusCode: 200,
    });
    const output = metrics.render();
    expect(output).toContain(
      'event_ticketing_http_requests_total{method="GET",path="/health/ready",status="200"} 1'
    );
    expect(output).toContain(
      'event_ticketing_http_request_duration_seconds_bucket{method="GET",path="/health/ready",status="200",le="0.05"} 1'
    );
  });
});
