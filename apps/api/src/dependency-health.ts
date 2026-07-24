import type { OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

import {
  createDatabaseClient,
  type PrismaClient,
} from "@event-ticketing/database";

export interface HealthDependency {
  ping(): Promise<void>;
}

export class DatabaseHealthDependency
  implements HealthDependency, OnApplicationShutdown
{
  private readonly client: PrismaClient;

  constructor(databaseUrl: string, timeoutMs: number) {
    this.client = createDatabaseClient(databaseUrl, {
      connectionTimeoutMs: timeoutMs,
      maxConnections: 5,
    });
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}

export class RedisHealthDependency
  implements HealthDependency, OnApplicationShutdown
{
  private readonly client: Redis;

  constructor(redisUrl: string, timeoutMs: number) {
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

  async ping(): Promise<void> {
    if (this.client.status === "wait" || this.client.status === "end") {
      await this.client.connect();
    }

    await this.client.ping();
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
