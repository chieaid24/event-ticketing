import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  loadApiConfig,
  loadWebConfig,
  loadWorkerConfig,
} from "./index.js";

describe("application configuration", () => {
  it("uses safe local development defaults", () => {
    expect(loadApiConfig({})).toEqual({
      databaseUrl:
        "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public",
      dependencyTimeoutMs: 2_000,
      host: "127.0.0.1",
      logLevel: "info",
      port: 4000,
      redisUrl: "redis://127.0.0.1:6379",
    });
    expect(loadWebConfig({})).toEqual({
      apiBaseUrl: "http://127.0.0.1:4000",
    });
    expect(loadWorkerConfig({})).toEqual({
      databaseUrl:
        "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public",
      logLevel: "info",
      outboxBatchSize: 10,
      outboxLeaseMs: 30_000,
      outboxPollIntervalMs: 1_000,
      outboxRetryBaseMs: 1_000,
      outboxRetryMaximumMs: 300_000,
      redisUrl: "redis://127.0.0.1:6379",
      shutdownTimeoutMs: 10_000,
    });
  });

  it("names invalid variables without exposing their values", () => {
    const secretValue =
      "postgresql://example-user:example-password@database.example.test/db";

    expect(() =>
      loadApiConfig({
        API_PORT: "70000",
        DATABASE_URL: secretValue,
      })
    ).toThrow(
      expect.objectContaining({
        message: "Invalid api configuration: API_PORT",
        variables: ["API_PORT"],
      })
    );

    try {
      loadApiConfig({
        API_PORT: "70000",
        DATABASE_URL: secretValue,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toContain(secretValue);
      expect(JSON.stringify(error)).not.toContain(secretValue);
    }
  });

  it("rejects dependency URLs with the wrong protocols", () => {
    expect(() =>
      loadWorkerConfig({
        DATABASE_URL: "https://database.example.test",
        REDIS_URL: "https://redis.example.test",
      })
    ).toThrow(
      expect.objectContaining({
        variables: ["DATABASE_URL", "REDIS_URL"],
      })
    );
  });

  it("names invalid outbox settings", () => {
    expect(() =>
      loadWorkerConfig({
        WORKER_OUTBOX_BATCH_SIZE: "0",
        WORKER_OUTBOX_LEASE_MS: "999",
      })
    ).toThrow(
      expect.objectContaining({
        variables: ["WORKER_OUTBOX_BATCH_SIZE", "WORKER_OUTBOX_LEASE_MS"],
      })
    );
  });

  it("requires the retry maximum to cover the base delay", () => {
    expect(() =>
      loadWorkerConfig({
        WORKER_OUTBOX_RETRY_BASE_MS: "2000",
        WORKER_OUTBOX_RETRY_MAXIMUM_MS: "1000",
      })
    ).toThrow(
      expect.objectContaining({
        variables: ["WORKER_OUTBOX_RETRY_MAXIMUM_MS"],
      })
    );
  });

  it("normalizes one trailing API URL slash", () => {
    expect(
      loadWebConfig({ API_BASE_URL: "https://api.example.test/" })
    ).toEqual({
      apiBaseUrl: "https://api.example.test",
    });
  });
});
