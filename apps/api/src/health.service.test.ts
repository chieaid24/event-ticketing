import { describe, expect, it } from "vitest";

import type { HealthDependency } from "./dependency-health.js";
import { HealthService } from "./health.service.js";

const available: HealthDependency = {
  ping: () => Promise.resolve(),
};

describe("HealthService", () => {
  it("reports ready only when every authoritative dependency responds", async () => {
    const service = new HealthService(available, available, 100);

    await expect(service.readiness()).resolves.toEqual({
      checks: {
        database: "up",
        redis: "up",
      },
      service: "api",
      status: "ready",
    });
  });

  it("reports a failed dependency without exposing its error", async () => {
    const privateError = new Error(
      "postgresql://example-user:example-password@database.example.test/database"
    );
    const service = new HealthService(
      {
        ping: () => Promise.reject(privateError),
      },
      available,
      100
    );

    const response = await service.readiness();

    expect(response).toEqual({
      checks: {
        database: "down",
        redis: "up",
      },
      service: "api",
      status: "not_ready",
    });
    expect(JSON.stringify(response)).not.toContain(privateError.message);
  });

  it("bounds dependency checks", async () => {
    const service = new HealthService(
      {
        ping: () => new Promise(() => undefined),
      },
      available,
      5
    );

    await expect(service.readiness()).resolves.toMatchObject({
      checks: {
        database: "down",
      },
      status: "not_ready",
    });
  });
});
