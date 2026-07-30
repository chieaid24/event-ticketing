import { describe, expect, it } from "vitest";

import {
  analyticsRangeQuerySchema,
  operationsJobSchema,
  retryJobRequestSchema,
} from "./operations.js";

describe("operations contracts", () => {
  it("accepts an ordered analytics range", () => {
    expect(
      analyticsRangeQuerySchema.parse({
        from: "2026-07-01",
        to: "2026-07-30",
      })
    ).toEqual({ from: "2026-07-01", to: "2026-07-30" });
  });

  it("rejects a reversed analytics range", () => {
    expect(() =>
      analyticsRangeQuerySchema.parse({
        from: "2026-07-30",
        to: "2026-07-01",
      })
    ).toThrow();
  });

  it("does not expose a job payload", () => {
    expect(() =>
      operationsJobSchema.parse({
        aggregateId: null,
        aggregateType: null,
        attemptCount: 8,
        availableAt: "2026-07-30T12:00:00.000Z",
        createdAt: "2026-07-30T12:00:00.000Z",
        deadLetteredAt: "2026-07-30T12:01:00.000Z",
        id: "12c4244c-2041-4d01-ae48-1de95616466c",
        lastErrorCode: "provider_timeout",
        maxAttempts: 8,
        organizationId: null,
        payload: { secret: "must-not-cross-the-contract" },
        status: "dead_letter",
        topic: "refund.requested",
        updatedAt: "2026-07-30T12:01:00.000Z",
      })
    ).toThrow();
  });

  it("requires optimistic concurrency for a job retry", () => {
    expect(() => retryJobRequestSchema.parse({})).toThrow();
  });
});
