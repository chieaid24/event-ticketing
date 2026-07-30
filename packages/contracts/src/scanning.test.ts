import { describe, expect, it } from "vitest";

import {
  checkInRequestSchema,
  checkInResponseSchema,
  reversalRequestSchema,
  scanActivityResponseSchema,
} from "./scanning.js";

const deviceId = "11111111-2222-4333-8444-555555555555";

describe("checkInRequestSchema", () => {
  it("accepts a QR credential", () => {
    const parsed = checkInRequestSchema.safeParse({
      deviceId,
      qrToken: "a".repeat(64),
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a manual public number", () => {
    const parsed = checkInRequestSchema.safeParse({
      deviceId,
      publicNumber: "TK-0123456789AB",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects both credentials at once", () => {
    const parsed = checkInRequestSchema.safeParse({
      deviceId,
      publicNumber: "TK-0123456789AB",
      qrToken: "a".repeat(64),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a request with no credential", () => {
    const parsed = checkInRequestSchema.safeParse({ deviceId });
    expect(parsed.success).toBe(false);
  });

  it("rejects a device id with unexpected characters", () => {
    const parsed = checkInRequestSchema.safeParse({
      deviceId: "short id!",
      qrToken: "a".repeat(64),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("reversalRequestSchema", () => {
  it("requires a substantive reason", () => {
    const parsed = reversalRequestSchema.safeParse({
      deviceId,
      reason: "  no ",
      ticketId: "8b0f4a70-0d2c-4f3a-8a5e-0a1b2c3d4e5f",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("checkInResponseSchema", () => {
  it("never carries a reversed result", () => {
    const parsed = checkInResponseSchema.safeParse({
      result: "reversed",
      scanId: "8b0f4a70-0d2c-4f3a-8a5e-0a1b2c3d4e5f",
      ticket: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("scanActivityResponseSchema", () => {
  it("parses an activity page with reversal capability", () => {
    const parsed = scanActivityResponseSchema.safeParse({
      canReverse: true,
      scans: [
        {
          actorEmail: "scanner@example.test",
          createdAt: "2026-07-30T12:00:00.000Z",
          id: "8b0f4a70-0d2c-4f3a-8a5e-0a1b2c3d4e5f",
          reason: null,
          result: "accepted",
          ticketId: "9c1f5b81-1e3d-4a4b-9b6f-1b2c3d4e5f60",
          ticketPublicNumber: "TK-0123456789AB",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
