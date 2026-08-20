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
      cookieSecure: false,
      databaseUrl:
        "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public",
      dependencyTimeoutMs: 2_000,
      host: "127.0.0.1",
      logLevel: "info",
      paymentProvider: "fake",
      paymentWebhookSecret: "whsec_local_development_only",
      port: 4000,
      redisUrl: "redis://127.0.0.1:6379",
      sessionAbsoluteTtlSeconds: 2_592_000,
      sessionIdleTtlSeconds: 86_400,
      trustedOrigins: ["http://127.0.0.1:3000", "http://localhost:3000"],
      waitingRoomAdmissionCapacity: 100,
      waitingRoomHeartbeatTtlSeconds: 60,
      waitingRoomLeaseTtlSeconds: 300,
      waitingRoomTokenSecret: "local-waiting-room-secret-only-32-bytes",
      waitingRoomTokenTtlSeconds: 1_800,
    });
    expect(loadWebConfig({})).toEqual({
      apiBaseUrl: "http://127.0.0.1:4000",
    });
    expect(loadWorkerConfig({})).toEqual({
      databaseUrl:
        "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public",
      logLevel: "info",
      mailFrom: "Event Ticketing <no-reply@example.test>",
      opsAlertEmail: "ops@example.test",
      outboxBatchSize: 10,
      outboxLeaseMs: 30_000,
      outboxPollIntervalMs: 1_000,
      outboxRetryBaseMs: 1_000,
      outboxRetryMaximumMs: 300_000,
      paymentProvider: "fake",
      redisUrl: "redis://127.0.0.1:6379",
      resetTokenTtlSeconds: 1_800,
      shutdownTimeoutMs: 10_000,
      smtpUrl: "smtp://127.0.0.1:1025",
      verificationTokenTtlSeconds: 86_400,
      webBaseUrl: "http://127.0.0.1:3000",
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

  it("reads the Front Door profile ID and rejects a blank one", () => {
    expect(loadApiConfig({}).frontDoorProfileId).toBeUndefined();
    expect(
      loadApiConfig({
        API_FRONT_DOOR_PROFILE_ID: "11111111-2222-3333-4444-555555555555",
      }).frontDoorProfileId
    ).toBe("11111111-2222-3333-4444-555555555555");
    expect(() => loadApiConfig({ API_FRONT_DOOR_PROFILE_ID: "" })).toThrow(
      expect.objectContaining({
        variables: ["API_FRONT_DOOR_PROFILE_ID"],
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

describe("production secret requirements", () => {
  it("rejects missing api secrets in production", () => {
    expect(() => loadApiConfig({ NODE_ENV: "production" })).toThrow(
      expect.objectContaining({
        variables: ["PAYMENT_WEBHOOK_SECRET", "WAITING_ROOM_TOKEN_SECRET"],
      })
    );
  });

  it("rejects the publicly known development defaults in production", () => {
    expect(() =>
      loadApiConfig({
        NODE_ENV: "production",
        PAYMENT_WEBHOOK_SECRET: "whsec_local_development_only",
        WAITING_ROOM_TOKEN_SECRET: "local-waiting-room-secret-only-32-bytes",
      })
    ).toThrow(
      expect.objectContaining({
        variables: ["PAYMENT_WEBHOOK_SECRET", "WAITING_ROOM_TOKEN_SECRET"],
      })
    );
  });

  it("accepts production once both secrets are explicit", () => {
    const config = loadApiConfig({
      NODE_ENV: "production",
      PAYMENT_WEBHOOK_SECRET: "whsec_example_value",
      WAITING_ROOM_TOKEN_SECRET: "an-explicit-secret-of-32-characters!",
    });
    expect(config.paymentWebhookSecret).toBe("whsec_example_value");
    expect(config.waitingRoomTokenSecret).toBe(
      "an-explicit-secret-of-32-characters!"
    );
  });

  it("keeps development defaults outside production", () => {
    expect(loadApiConfig({ NODE_ENV: "test" }).paymentWebhookSecret).toBe(
      "whsec_local_development_only"
    );
  });
});

describe("payment provider configuration", () => {
  it("requires stripe credentials when the provider is stripe", () => {
    expect(() => loadApiConfig({ PAYMENT_PROVIDER: "stripe" })).toThrowError(
      ConfigurationError
    );
    try {
      loadApiConfig({ PAYMENT_PROVIDER: "stripe" });
    } catch (error) {
      expect((error as ConfigurationError).variables).toEqual([
        "STRIPE_PUBLISHABLE_KEY",
        "STRIPE_SECRET_KEY",
      ]);
    }
    expect(() => loadWorkerConfig({ PAYMENT_PROVIDER: "stripe" })).toThrowError(
      ConfigurationError
    );
  });

  it("accepts stripe once its keys are present", () => {
    const config = loadApiConfig({
      PAYMENT_PROVIDER: "stripe",
      PAYMENT_WEBHOOK_SECRET: "whsec_example_value",
      STRIPE_PUBLISHABLE_KEY: "pk_test_example",
      STRIPE_SECRET_KEY: "sk_test_example",
    });
    expect(config.paymentProvider).toBe("stripe");
    expect(config.stripePublishableKey).toBe("pk_test_example");
  });

  it("rejects an unknown provider and a short webhook secret", () => {
    expect(() => loadApiConfig({ PAYMENT_PROVIDER: "paypal" })).toThrowError(
      ConfigurationError
    );
    expect(() =>
      loadApiConfig({ PAYMENT_WEBHOOK_SECRET: "short" })
    ).toThrowError(ConfigurationError);
  });
});
