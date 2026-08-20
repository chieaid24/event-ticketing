import type { OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import type { Logger } from "pino";

export interface RateLimiter {
  consume(key: string, max: number, windowMs: number): Promise<boolean>;
}

// local load-test bypass; production rejects the flag
export class DisabledRateLimiter implements RateLimiter {
  consume(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export class RedisRateLimiter implements RateLimiter, OnApplicationShutdown {
  private readonly client: Redis;

  constructor(
    redisUrl: string,
    timeoutMs: number,
    private readonly logger: Logger
  ) {
    this.client = new Redis(redisUrl, {
      commandTimeout: timeoutMs,
      connectTimeout: timeoutMs,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    this.client.on("error", () => undefined);
  }

  async consume(key: string, max: number, windowMs: number): Promise<boolean> {
    try {
      if (this.client.status === "wait" || this.client.status === "end") {
        await this.client.connect();
      }

      const redisKey = `rate:${key}`;
      const count = await this.client.incr(redisKey);
      if (count === 1) {
        await this.client.pexpire(redisKey, windowMs);
      }
      return count <= max;
    } catch {
      // fail open: unavailable limiter must not lock everyone out
      this.logger.warn({ event: "auth.rate_limit.unavailable" });
      return true;
    }
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
