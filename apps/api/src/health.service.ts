import { Inject, Injectable } from "@nestjs/common";

import type { HealthDependency } from "./dependency-health.js";
import { DATABASE_HEALTH, REDIS_HEALTH } from "./runtime.tokens.js";

export interface ReadinessResponse {
  checks: {
    database: "up" | "down";
    redis: "up" | "down";
  };
  service: "api";
  status: "ready" | "not_ready";
}

async function checkWithin(
  dependency: HealthDependency,
  timeoutMs: number
): Promise<"up" | "down"> {
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      dependency.ping(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Health check timed out.")),
          timeoutMs
        );
      }),
    ]);
    return "up";
  } catch {
    return "down";
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_HEALTH)
    private readonly database: HealthDependency,
    @Inject(REDIS_HEALTH)
    private readonly redis: HealthDependency,
    private readonly timeoutMs: number
  ) {}

  async readiness(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      checkWithin(this.database, this.timeoutMs),
      checkWithin(this.redis, this.timeoutMs),
    ]);

    return {
      checks: {
        database,
        redis,
      },
      service: "api",
      status: database === "up" && redis === "up" ? "ready" : "not_ready",
    };
  }
}
