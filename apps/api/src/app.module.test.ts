import type { FactoryProvider } from "@nestjs/common";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { loadApiConfig } from "@event-ticketing/config";

import { AppModule } from "./app.module.js";
import { DisabledRateLimiter, RedisRateLimiter } from "./auth/rate-limiter.js";
import { PaymentsSimulationController } from "./checkout/payments-simulation.controller.js";
import { AUTH_RATE_LIMITER } from "./runtime.tokens.js";

const logger = pino({ level: "silent" });

const stripeEnvironment = {
  PAYMENT_PROVIDER: "stripe",
  STRIPE_PUBLISHABLE_KEY: "pk_test_example",
  STRIPE_SECRET_KEY: "sk_test_example",
};

function rateLimiterFactory(config: Parameters<typeof AppModule.register>[0]) {
  const module = AppModule.register(config, logger);
  const provider = module.providers?.find(
    (candidate): candidate is FactoryProvider =>
      typeof candidate === "object" &&
      "provide" in candidate &&
      candidate.provide === AUTH_RATE_LIMITER
  );
  if (provider === undefined) {
    throw new Error("The rate limiter provider is missing.");
  }
  return provider.useFactory as () => unknown;
}

describe("AppModule.register", () => {
  it("mounts the payments simulation surface only for the fake provider", () => {
    expect(AppModule.register(loadApiConfig({}), logger).controllers).toContain(
      PaymentsSimulationController
    );
    expect(
      AppModule.register(loadApiConfig(stripeEnvironment), logger).controllers
    ).not.toContain(PaymentsSimulationController);
  });

  it("keeps the Redis rate limiter unless the load-test bypass is set", () => {
    const limiter = rateLimiterFactory(loadApiConfig({}))();
    expect(limiter).toBeInstanceOf(RedisRateLimiter);
    (limiter as RedisRateLimiter).onApplicationShutdown();

    expect(
      rateLimiterFactory(loadApiConfig({ API_RATE_LIMITS_DISABLED: "true" }))()
    ).toBeInstanceOf(DisabledRateLimiter);
  });

  it("always allows requests through the disabled rate limiter", async () => {
    await expect(new DisabledRateLimiter().consume()).resolves.toBe(true);
  });
});
