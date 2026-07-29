import type { OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import type { Pool } from "pg";

import { createDatabasePool } from "@event-ticketing/database";

export interface QueuePosition {
  joinedAt: number;
  position: number;
  queueDepth: number;
}

export type AdmissionResult =
  | ({ kind: "queued" } & QueuePosition)
  | {
      admissionRatePerMinute: number;
      joinedAt: number;
      kind: "admitted";
      queueDepth: number;
    };

export interface WaitingRoomStore {
  consumeAdmission(input: {
    eventId: string;
    expiresAt: number;
    idempotencyKey: string;
    nonce: string;
    now: number;
    sessionId: string;
  }): Promise<boolean>;
  eventRequiresAdmission(eventId: string): Promise<boolean | null>;
  heartbeat(input: {
    eventId: string;
    expiresAt: number;
    sessionId: string;
  }): Promise<boolean>;
  join(input: {
    eventId: string;
    heartbeatExpiresAt: number;
    joinedAt: number;
    sessionId: string;
  }): Promise<QueuePosition>;
  statusAndAdmit(input: {
    admissionCapacity: number;
    admissionExpiresAt: number;
    eventId: string;
    heartbeatExpiresAt: number;
    nonce: string;
    now: number;
    sessionId: string;
  }): Promise<AdmissionResult>;
}

const JOIN_SCRIPT = `
local score = redis.call("ZSCORE", KEYS[1], ARGV[1])
if not score then
  score = redis.call("INCR", KEYS[2])
  redis.call("ZADD", KEYS[1], score, ARGV[1])
  redis.call("HSET", KEYS[3], ARGV[1], ARGV[2])
end
redis.call("ZADD", KEYS[4], ARGV[3], ARGV[1])
return {
  redis.call("ZRANK", KEYS[1], ARGV[1]) + 1,
  redis.call("ZCARD", KEYS[1]),
  redis.call("HGET", KEYS[3], ARGV[1])
}
`;

const HEARTBEAT_SCRIPT = `
if not redis.call("ZSCORE", KEYS[1], ARGV[1]) then
  return 0
end
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[1])
return 1
`;

const ADMIT_SCRIPT = `
local expired = redis.call("ZRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
for _, actor in ipairs(expired) do
  redis.call("ZREM", KEYS[1], actor)
  redis.call("HDEL", KEYS[3], actor)
end
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
redis.call("ZREMRANGEBYSCORE", KEYS[4], "-inf", ARGV[1])
redis.call("ZREMRANGEBYSCORE", KEYS[6], "-inf", ARGV[1] - 60000)

local rank = redis.call("ZRANK", KEYS[1], ARGV[2])
if not rank then
  return {-1}
end
local depth = redis.call("ZCARD", KEYS[1])
local joined = redis.call("HGET", KEYS[3], ARGV[2])
redis.call("ZADD", KEYS[2], ARGV[3], ARGV[2])

if rank == 0 and redis.call("ZCARD", KEYS[4]) < tonumber(ARGV[4]) then
  redis.call("ZREM", KEYS[1], ARGV[2])
  redis.call("ZREM", KEYS[2], ARGV[2])
  redis.call("HDEL", KEYS[3], ARGV[2])
  redis.call("ZADD", KEYS[4], ARGV[5], ARGV[2])
  redis.call("SET", KEYS[5], ARGV[2], "PXAT", ARGV[5], "NX")
  redis.call("ZADD", KEYS[6], ARGV[1], ARGV[6])
  return {1, depth - 1, joined, redis.call("ZCARD", KEYS[6])}
end

return {0, rank + 1, depth, joined}
`;

const CONSUME_SCRIPT = `
local lease = redis.call("ZSCORE", KEYS[1], ARGV[1])
if not lease or tonumber(lease) < tonumber(ARGV[2]) then
  return 0
end
local value = redis.call("GET", KEYS[2])
if value == ("used:" .. ARGV[1] .. ":" .. ARGV[4]) then
  return 1
end
if value ~= ARGV[1] then
  return 0
end
redis.call("SET", KEYS[2], "used:" .. ARGV[1] .. ":" .. ARGV[4], "PXAT", ARGV[3])
return 1
`;

function keys(eventId: string): {
  admissions: string;
  heartbeats: string;
  joined: string;
  leases: string;
  queue: string;
  sequence: string;
} {
  const prefix = `waiting-room:${eventId}`;
  return {
    admissions: `${prefix}:admissions`,
    heartbeats: `${prefix}:heartbeats`,
    joined: `${prefix}:joined`,
    leases: `${prefix}:leases`,
    queue: `${prefix}:queue`,
    sequence: `${prefix}:sequence`,
  };
}

function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid Redis waiting-room response.");
  }
  return value.map((part) => Number(part));
}

export class RedisWaitingRoomStore
  implements WaitingRoomStore, OnApplicationShutdown
{
  private readonly database: Pool;
  private readonly redis: Redis;
  private connecting: Promise<void> | null = null;

  constructor(databaseUrl: string, redisUrl: string, timeoutMs: number) {
    this.database = createDatabasePool(databaseUrl, { maxConnections: 5 });
    this.redis = new Redis(redisUrl, {
      commandTimeout: timeoutMs,
      connectTimeout: timeoutMs,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    this.redis.on("error", () => undefined);
  }

  async eventRequiresAdmission(eventId: string): Promise<boolean | null> {
    const result = await this.database.query<{ enabled: boolean }>(
      `SELECT "waiting_room_enabled" AS "enabled"
       FROM "events" WHERE "id" = $1 AND "status" = 'published'`,
      [eventId]
    );
    return result.rows[0]?.enabled ?? null;
  }

  async join(input: {
    eventId: string;
    heartbeatExpiresAt: number;
    joinedAt: number;
    sessionId: string;
  }): Promise<QueuePosition> {
    await this.connect();
    const eventKeys = keys(input.eventId);
    const result = numbers(
      await this.redis.eval(
        JOIN_SCRIPT,
        4,
        eventKeys.queue,
        eventKeys.sequence,
        eventKeys.joined,
        eventKeys.heartbeats,
        input.sessionId,
        input.joinedAt,
        input.heartbeatExpiresAt
      )
    );
    return {
      joinedAt: result[2]!,
      position: result[0]!,
      queueDepth: result[1]!,
    };
  }

  async heartbeat(input: {
    eventId: string;
    expiresAt: number;
    sessionId: string;
  }): Promise<boolean> {
    await this.connect();
    const eventKeys = keys(input.eventId);
    return (
      Number(
        await this.redis.eval(
          HEARTBEAT_SCRIPT,
          2,
          eventKeys.queue,
          eventKeys.heartbeats,
          input.sessionId,
          input.expiresAt
        )
      ) === 1
    );
  }

  async statusAndAdmit(input: {
    admissionCapacity: number;
    admissionExpiresAt: number;
    eventId: string;
    heartbeatExpiresAt: number;
    nonce: string;
    now: number;
    sessionId: string;
  }): Promise<AdmissionResult> {
    await this.connect();
    const eventKeys = keys(input.eventId);
    const admissionKey = `waiting-room:${input.eventId}:admission:${input.nonce}`;
    const result = numbers(
      await this.redis.eval(
        ADMIT_SCRIPT,
        6,
        eventKeys.queue,
        eventKeys.heartbeats,
        eventKeys.joined,
        eventKeys.leases,
        admissionKey,
        eventKeys.admissions,
        input.now,
        input.sessionId,
        input.heartbeatExpiresAt,
        input.admissionCapacity,
        input.admissionExpiresAt,
        input.nonce
      )
    );
    if (result[0] === -1) {
      throw new Error("Waiting-room queue entry expired.");
    }
    if (result[0] === 1) {
      return {
        admissionRatePerMinute: result[3]!,
        joinedAt: result[2]!,
        kind: "admitted",
        queueDepth: result[1]!,
      };
    }
    return {
      joinedAt: result[3]!,
      kind: "queued",
      position: result[1]!,
      queueDepth: result[2]!,
    };
  }

  async consumeAdmission(input: {
    eventId: string;
    expiresAt: number;
    idempotencyKey: string;
    nonce: string;
    now: number;
    sessionId: string;
  }): Promise<boolean> {
    await this.connect();
    const eventKeys = keys(input.eventId);
    const admissionKey = `waiting-room:${input.eventId}:admission:${input.nonce}`;
    return (
      Number(
        await this.redis.eval(
          CONSUME_SCRIPT,
          2,
          eventKeys.leases,
          admissionKey,
          input.sessionId,
          input.now,
          input.expiresAt,
          input.idempotencyKey
        )
      ) === 1
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
    await this.database.end();
  }

  private async connect(): Promise<void> {
    if (this.redis.status === "ready") {
      return;
    }
    if (!this.connecting) {
      this.connecting = this.redis.connect().finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
  }
}
