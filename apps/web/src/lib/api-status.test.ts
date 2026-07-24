import { describe, expect, it, vi } from "vitest";

import { fetchApiStatus } from "./api-status";

describe("fetchApiStatus", () => {
  it("accepts a response that matches the shared contract", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          service: "api",
          status: "available",
          version: 1,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      )
    );

    await expect(
      fetchApiStatus("https://api.example.test", request)
    ).resolves.toEqual({
      data: {
        service: "api",
        status: "available",
        version: 1,
      },
      kind: "available",
    });
  });

  it("does not expose an invalid API response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "available", secret: "value" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    await expect(
      fetchApiStatus("https://api.example.test", request)
    ).resolves.toEqual({
      kind: "unavailable",
    });
  });
});
