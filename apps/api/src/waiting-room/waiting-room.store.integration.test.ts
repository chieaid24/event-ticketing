import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisWaitingRoomStore } from "./waiting-room.store.js";

const enabled = process.env["WAITING_ROOM_LOAD_TEST"] === "true";
const redisUrl = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
const databaseUrl =
  process.env["DATABASE_URL"] ??
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing";
const eventId = randomUUID();
const prefix = `waiting-room:${eventId}`;
const actorCount = 500;
const admissionCapacity = 25;

function percentile(values: number[], proportion: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * proportion) - 1] ?? 0;
}

describe.runIf(enabled)("RedisWaitingRoomStore load probe", () => {
  const redis = new Redis(redisUrl);
  const store = new RedisWaitingRoomStore(databaseUrl, redisUrl, 2_000);

  beforeAll(async () => {
    await redis.ping();
  });

  afterAll(async () => {
    await redis.del(
      `${prefix}:admissions`,
      `${prefix}:heartbeats`,
      `${prefix}:joined`,
      `${prefix}:leases`,
      `${prefix}:queue`,
      `${prefix}:sequence`
    );
    redis.disconnect();
    await store.onApplicationShutdown();
  });

  it("measures bounded duplicate joins and atomic admission", async () => {
    const actors = Array.from({ length: actorCount }, () => randomUUID());
    const joinedAt = Date.now();
    const joinLatencies: number[] = [];
    const joinStarted = performance.now();
    const positions = await Promise.all(
      actors.map(async (sessionId) => {
        const started = performance.now();
        const position = await store.join({
          eventId,
          heartbeatExpiresAt: joinedAt + 60_000,
          joinedAt,
          sessionId,
        });
        joinLatencies.push(performance.now() - started);
        return position;
      })
    );
    const joinDurationMs = performance.now() - joinStarted;

    const duplicate = await store.join({
      eventId,
      heartbeatExpiresAt: joinedAt + 60_000,
      joinedAt,
      sessionId: actors[0]!,
    });
    expect(duplicate.queueDepth).toBe(actorCount);
    expect(new Set(positions.map((value) => value.position)).size).toBe(
      actorCount
    );

    const admissionNow = Date.now();
    const admissionLatencies: number[] = [];
    const admissionStarted = performance.now();
    const outcomes = await Promise.all(
      actors.map(async (sessionId) => {
        const started = performance.now();
        const nonce = randomUUID();
        const result = await store.statusAndAdmit({
          admissionCapacity,
          admissionExpiresAt: admissionNow + 300_000,
          eventId,
          heartbeatExpiresAt: admissionNow + 60_000,
          nonce,
          now: admissionNow,
          sessionId,
        });
        admissionLatencies.push(performance.now() - started);
        return { nonce, result, sessionId };
      })
    );
    const admissionDurationMs = performance.now() - admissionStarted;
    const admitted = outcomes.filter(
      (outcome) => outcome.result.kind === "admitted"
    );
    const queueDepth = outcomes.at(-1)?.result.queueDepth ?? -1;
    const lastAdmission = admitted.at(-1)?.result;
    const admissionRatePerMinute =
      lastAdmission?.kind === "admitted"
        ? lastAdmission.admissionRatePerMinute
        : 0;
    const waitValues = admitted.map((outcome) =>
      Math.max(0, admissionNow - outcome.result.joinedAt)
    );
    const firstAdmission = admitted[0]!;
    const replayInput = {
      eventId,
      expiresAt: admissionNow + 300_000,
      idempotencyKey: "hold-attempt-1",
      nonce: firstAdmission.nonce,
      now: admissionNow,
      sessionId: firstAdmission.sessionId,
    };
    await expect(store.consumeAdmission(replayInput)).resolves.toBe(true);
    await expect(store.consumeAdmission(replayInput)).resolves.toBe(true);
    await expect(
      store.consumeAdmission({
        ...replayInput,
        idempotencyKey: "different-hold-attempt",
      })
    ).resolves.toBe(false);

    const report = {
      admission: {
        admitted: admitted.length,
        capacity: admissionCapacity,
        durationMs: Number(admissionDurationMs.toFixed(2)),
        p50Ms: Number(percentile(admissionLatencies, 0.5).toFixed(2)),
        p95Ms: Number(percentile(admissionLatencies, 0.95).toFixed(2)),
        p99Ms: Number(percentile(admissionLatencies, 0.99).toFixed(2)),
        ratePerMinute: admissionRatePerMinute,
      },
      joins: {
        actors: actorCount,
        durationMs: Number(joinDurationMs.toFixed(2)),
        p50Ms: Number(percentile(joinLatencies, 0.5).toFixed(2)),
        p95Ms: Number(percentile(joinLatencies, 0.95).toFixed(2)),
        p99Ms: Number(percentile(joinLatencies, 0.99).toFixed(2)),
        throughputPerSecond: Number(
          (actorCount / (joinDurationMs / 1_000)).toFixed(2)
        ),
      },
      queueDepth,
      waitMs: {
        p50: percentile(waitValues, 0.5),
        p95: percentile(waitValues, 0.95),
        p99: percentile(waitValues, 0.99),
      },
    };
    process.stdout.write(
      `WAITING_ROOM_LOAD_RESULT ${JSON.stringify(report)}\n`
    );

    expect(admitted).toHaveLength(admissionCapacity);
    expect(queueDepth).toBe(actorCount - admissionCapacity);
    expect(admissionRatePerMinute).toBe(admissionCapacity);
    expect(report.joins.p95Ms).toBeLessThan(1_000);
    expect(report.admission.p95Ms).toBeLessThan(1_000);
  });
});
