import type { OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import type { Logger } from "pino";

import {
  mirrorHoldExpiry,
  type HoldExpiryMirrorClient,
} from "@event-ticketing/database";

export interface HoldExpiryMirror {
  set(holdId: string, expiresAt: Date): Promise<void>;
}

// empty prefix keeps shared bare key form
const HOLD_EXPIRY_PREFIX = "";

// postgres owns expiry; mirror failures fail open
export class RedisHoldExpiryMirror
  implements HoldExpiryMirror, OnApplicationShutdown
{
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

  async set(holdId: string, expiresAt: Date): Promise<void> {
    try {
      if (this.client.status === "wait" || this.client.status === "end") {
        await this.client.connect();
      }
      await mirrorHoldExpiry(this.mirrorClient(), {
        expiresAt,
        holdId,
        prefix: HOLD_EXPIRY_PREFIX,
      });
    } catch {
      this.logger.warn({ event: "holds.expiry_mirror.unavailable", holdId });
    }
  }

  private mirrorClient(): HoldExpiryMirrorClient {
    return {
      del: (key) => this.client.del(key),
      get: (key) => this.client.get(key),
      set: (key, value, mode, ttlMs) =>
        this.client.set(key, value, mode, ttlMs),
    };
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
