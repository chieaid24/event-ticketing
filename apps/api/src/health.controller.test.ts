import { describe, expect, it, vi } from "vitest";

import { HealthController } from "./health.controller.js";
import type { HealthService } from "./health.service.js";

describe("HealthController", () => {
  it("keeps liveness independent from dependencies", () => {
    const controller = new HealthController({} as HealthService);

    expect(controller.liveness()).toEqual({
      service: "api",
      status: "live",
    });
  });

  it("returns 503 when readiness fails", async () => {
    const readiness = {
      checks: {
        database: "up" as const,
        redis: "down" as const,
      },
      service: "api" as const,
      status: "not_ready" as const,
    };
    const controller = new HealthController({
      readiness: vi.fn().mockResolvedValue(readiness),
    } as unknown as HealthService);
    const response = {
      status: vi.fn(),
    };

    await expect(controller.readiness(response as never)).resolves.toEqual(
      readiness
    );
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
