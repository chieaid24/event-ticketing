import { describe, expect, it } from "vitest";

import { statusResponseSchema } from "./status.js";

describe("statusResponseSchema", () => {
  it("accepts the public API status contract", () => {
    expect(
      statusResponseSchema.parse({
        service: "api",
        status: "available",
        version: 1,
      })
    ).toEqual({
      service: "api",
      status: "available",
      version: 1,
    });
  });

  it("rejects unknown response fields", () => {
    expect(() =>
      statusResponseSchema.parse({
        internalHost: "private.example",
        service: "api",
        status: "available",
        version: 1,
      })
    ).toThrow();
  });
});
