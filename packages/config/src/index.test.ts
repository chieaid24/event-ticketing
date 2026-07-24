import { describe, expect, it } from "vitest";

import { loadApiConfig, loadWebConfig, loadWorkerConfig } from "./index.js";

describe("application configuration", () => {
  it("uses safe local development defaults", () => {
    expect(loadApiConfig({})).toEqual({
      host: "127.0.0.1",
      port: 4000,
    });
    expect(loadWebConfig({})).toEqual({
      apiBaseUrl: "http://127.0.0.1:4000",
    });
    expect(loadWorkerConfig({})).toEqual({
      shutdownTimeoutMs: 10_000,
    });
  });

  it("rejects invalid ports without exposing values", () => {
    expect(() => loadApiConfig({ API_PORT: "70000" })).toThrow();
  });

  it("normalizes one trailing API URL slash", () => {
    expect(
      loadWebConfig({ API_BASE_URL: "https://api.example.test/" })
    ).toEqual({
      apiBaseUrl: "https://api.example.test",
    });
  });
});
