import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import pg from "pg";

import {
  consumeAuthToken,
  createAuthToken,
  createSession,
  createUser,
  generateAuthSecret,
  hashAuthSecret,
  listActiveSessions,
  markUserEmailVerified,
  revokeSessionById,
  revokeUserSessions,
} from "../src/auth.js";
import {
  createDatabasePool,
  createOutboxRepository,
  enqueueOutboxEvent,
  withDatabaseTransaction,
} from "../src/outbox.js";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";
const baseDatabaseUrl = process.env["DATABASE_URL"] ?? localDatabaseUrl;
const redisUrl = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
const scope = randomUUID().replaceAll("-", "");
const schema = `test_${scope}`;
const redisPrefix = `test:${scope}:`;
const scopedDatabaseUrl = new URL(baseDatabaseUrl);
scopedDatabaseUrl.searchParams.set("schema", schema);
const adminDatabaseUrl = new URL(baseDatabaseUrl);
adminDatabaseUrl.searchParams.delete("schema");

const admin = new pg.Client({ connectionString: adminDatabaseUrl.toString() });
const redis = new Redis(redisUrl, {
  connectTimeout: 2_000,
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 0,
});
let adminConnected = false;

function runPrisma(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("prisma", [...args, "--config", "prisma.config.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: scopedDatabaseUrl.toString(),
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Prisma exited with ${
            signal ? `signal ${signal}` : `code ${String(code)}`
          }.`
        )
      );
    });
  });
}

async function deleteRedisScope(): Promise<void> {
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${redisPrefix}*`,
      "COUNT",
      100
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE SCHEMA "${schema}"`);

  await runPrisma(["migrate", "deploy"]);
  await runPrisma(["db", "seed"]);
  await runPrisma(["db", "seed"]);

  const pool = createDatabasePool(scopedDatabaseUrl.toString(), {
    maxConnections: 12,
  });
  const outbox = createOutboxRepository(pool);

  try {
    const baseline = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM "users") AS "users",
        (SELECT count(*)::int FROM "organizations") AS "organizations",
        (
          SELECT count(*)::int FROM "organization_memberships"
        ) AS "memberships",
        (SELECT count(*)::int FROM "outbox_events") AS "outbox_events"
    `);

    assert.deepEqual(baseline.rows, [
      {
        memberships: 1,
        organizations: 1,
        outbox_events: 1,
        users: 1,
      },
    ]);

    const rollbackId = "44444444-4444-4444-8444-444444444444";
    await assert.rejects(
      withDatabaseTransaction(pool, async (transaction) => {
        await transaction.query(
          `
            INSERT INTO "organizations" ("id", "name", "slug")
            VALUES ($1, $2, $3)
          `,
          [rollbackId, "Rollback Test Organization", "rollback-test"]
        );
        await enqueueOutboxEvent(transaction, {
          aggregateId: rollbackId,
          aggregateType: "organization",
          deduplicationKey: `organization.created:${rollbackId}`,
          payload: { organizationId: rollbackId },
          topic: "organization.created",
        });
        throw new Error("rollback probe");
      }),
      /rollback probe/
    );
    const rolledBack = await pool.query(
      `
        SELECT
          (SELECT count(*)::int FROM "organizations" WHERE "id" = $1) AS "domain",
          (
            SELECT count(*)::int
            FROM "outbox_events"
            WHERE "aggregate_id" = $1
          ) AS "outbox"
      `,
      [rollbackId]
    );
    assert.deepEqual(rolledBack.rows, [{ domain: 0, outbox: 0 }]);

    const committedId = "55555555-5555-4555-8555-555555555555";
    await withDatabaseTransaction(pool, async (transaction) => {
      await transaction.query(
        `
          INSERT INTO "organizations" ("id", "name", "slug")
          VALUES ($1, $2, $3)
        `,
        [committedId, "Committed Test Organization", "committed-test"]
      );
      await enqueueOutboxEvent(transaction, {
        aggregateId: committedId,
        aggregateType: "organization",
        deduplicationKey: `organization.created:${committedId}`,
        payload: { organizationId: committedId },
        topic: "organization.created",
      });
    });

    for (let index = 0; index < 20; index += 1) {
      await outbox.enqueue({
        deduplicationKey: `concurrency:${index}`,
        payload: { index },
        topic: "integration.concurrent",
      });
    }

    const deduplicated = await Promise.all(
      Array.from({ length: 10 }, () =>
        outbox.enqueue({
          deduplicationKey: "integration:deduplicated-concurrently",
          payload: { kind: "deduplicated" },
          topic: "integration.deduplicated",
        })
      )
    );
    assert.equal(new Set(deduplicated.map(({ id }) => id)).size, 1);

    const [workerOne, workerTwo] = await Promise.all([
      outbox.claimBatch({
        batchSize: 100,
        leaseMs: 30_000,
        workerId: "integration-worker-one",
      }),
      outbox.claimBatch({
        batchSize: 100,
        leaseMs: 30_000,
        workerId: "integration-worker-two",
      }),
    ]);
    const claimedIds = [...workerOne, ...workerTwo].map((event) => event.id);

    assert.equal(claimedIds.length, 23);
    assert.equal(new Set(claimedIds).size, 23);

    await Promise.all([
      ...workerOne.map((event) =>
        outbox.completeEvent({
          eventId: event.id,
          handlerName: event.topic,
          workerId: "integration-worker-one",
        })
      ),
      ...workerTwo.map((event) =>
        outbox.completeEvent({
          eventId: event.id,
          handlerName: event.topic,
          workerId: "integration-worker-two",
        })
      ),
    ]);

    const seededEvent = [...workerOne, ...workerTwo].find(
      (event) => event.aggregateId === "22222222-2222-4222-8222-222222222222"
    );
    assert.ok(seededEvent);
    assert.equal(await outbox.hasHandlerReceipt(seededEvent.id), true);

    await pool.query(
      `
        UPDATE "outbox_events"
        SET
          "status" = 'pending',
          "available_at" = clock_timestamp(),
          "completed_at" = NULL,
          "updated_at" = clock_timestamp()
        WHERE "id" = $1
      `,
      [seededEvent.id]
    );
    const [redelivery] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-redelivery",
    });
    assert.equal(redelivery?.id, seededEvent.id);
    assert.equal(await outbox.hasHandlerReceipt(seededEvent.id), true);
    await outbox.completeEvent({
      eventId: seededEvent.id,
      handlerName: seededEvent.topic,
      workerId: "integration-redelivery",
    });

    await outbox.enqueue({
      availableAt: new Date(Date.now() + 600_000),
      deduplicationKey: "integration:delayed",
      payload: { kind: "delayed" },
      topic: "integration.delayed",
    });
    assert.deepEqual(
      await outbox.claimBatch({
        batchSize: 100,
        leaseMs: 30_000,
        workerId: "integration-delay-check",
      }),
      []
    );

    const retryEvent = await outbox.enqueue({
      deduplicationKey: "integration:retry",
      maxAttempts: 2,
      payload: { kind: "retry" },
      topic: "integration.retry",
    });
    const [firstAttempt] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-retry",
    });
    assert.equal(firstAttempt?.id, retryEvent.id);
    const retry = await outbox.failEvent({
      errorCode: "synthetic_failure",
      eventId: retryEvent.id,
      retryDelayMs: 0,
      workerId: "integration-retry",
    });
    assert.equal(retry.attemptCount, 1);
    assert.equal(retry.status, "pending");
    const [secondAttempt] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-retry",
    });
    assert.equal(secondAttempt?.id, retryEvent.id);
    const deadLetter = await outbox.failEvent({
      errorCode: "synthetic_failure",
      eventId: retryEvent.id,
      retryDelayMs: 0,
      workerId: "integration-retry",
    });
    assert.equal(deadLetter.attemptCount, 2);
    assert.equal(deadLetter.status, "dead_letter");

    const leaseEvent = await outbox.enqueue({
      deduplicationKey: "integration:lease",
      payload: { kind: "lease" },
      topic: "integration.lease",
    });
    await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-expired-worker",
    });
    await pool.query(
      `
        UPDATE "outbox_events"
        SET "locked_until" = clock_timestamp() - interval '1 second'
        WHERE "id" = $1
      `,
      [leaseEvent.id]
    );
    const [reclaimed] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-reclaimer",
    });
    assert.equal(reclaimed?.id, leaseEvent.id);
    assert.equal(reclaimed?.attemptCount, 2);
    await outbox.completeEvent({
      eventId: leaseEvent.id,
      handlerName: leaseEvent.topic,
      workerId: "integration-reclaimer",
    });

    const shutdownEvent = await outbox.enqueue({
      deduplicationKey: "integration:shutdown",
      payload: { kind: "shutdown" },
      topic: "integration.shutdown",
    });
    await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-stopping-worker",
    });
    assert.equal(await outbox.releaseClaims("integration-stopping-worker"), 1);
    const [released] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-next-worker",
    });
    assert.equal(released?.id, shutdownEvent.id);
    await outbox.completeEvent({
      eventId: shutdownEvent.id,
      handlerName: shutdownEvent.topic,
      workerId: "integration-next-worker",
    });

    const scheduleId = await outbox.upsertSchedule({
      intervalSeconds: 3_600,
      name: "integration-hourly",
      nextRunAt: new Date(Date.now() - 1_000),
      payload: { kind: "scheduled" },
      topic: "integration.scheduled",
    });
    const materialized = await Promise.all([
      outbox.materializeDueSchedules(10),
      outbox.materializeDueSchedules(10),
    ]);
    assert.equal(
      materialized.reduce((total, count) => total + count, 0),
      1
    );
    const scheduledEvents = await pool.query(
      `
        SELECT count(*)::int AS "count"
        FROM "outbox_events"
        WHERE "schedule_id" = $1
      `,
      [scheduleId]
    );
    assert.deepEqual(scheduledEvents.rows, [{ count: 1 }]);
    const [scheduled] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-schedule-worker",
    });
    assert.equal(scheduled?.topic, "integration.scheduled");
    await outbox.completeEvent({
      eventId: scheduled!.id,
      handlerName: scheduled!.topic,
      workerId: "integration-schedule-worker",
    });

    const metrics = await outbox.metrics();
    assert.equal(metrics.deadLetter, 1);
    assert.equal(metrics.pendingDelayed, 1);
    assert.equal(metrics.pendingReady, 0);
    assert.equal(metrics.processing, 0);

    const seededUser = await pool.query(
      `SELECT "password_hash" AS "passwordHash" FROM "users" WHERE "id" = $1`,
      ["11111111-1111-4111-8111-111111111111"]
    );
    assert.match(
      String(seededUser.rows[0]?.passwordHash),
      /^\$argon2id\$/,
      "The seeded user must carry an argon2id password hash."
    );

    const authUser = await createUser(pool, {
      email: "auth-probe@example.test",
      passwordHash: "$argon2id$synthetic-integration-hash",
    });
    assert.ok(authUser);
    assert.equal(authUser.status, "pending");
    assert.equal(
      await createUser(pool, {
        email: "auth-probe@example.test",
        passwordHash: "$argon2id$other-hash",
      }),
      null,
      "A duplicate email must not create a second user."
    );

    const verifiedUser = await markUserEmailVerified(pool, authUser.id);
    assert.equal(verifiedUser?.status, "active");
    assert.equal(
      await markUserEmailVerified(pool, authUser.id),
      null,
      "Verification must only transition pending users."
    );

    const singleUseSecret = generateAuthSecret();
    await createAuthToken(pool, {
      expiresAt: new Date(Date.now() + 60_000),
      purpose: "password_reset",
      tokenHash: hashAuthSecret(singleUseSecret),
      userId: authUser.id,
    });
    const concurrentConsumes = await Promise.all(
      Array.from({ length: 5 }, () =>
        consumeAuthToken(pool, {
          purpose: "password_reset",
          tokenHash: hashAuthSecret(singleUseSecret),
        })
      )
    );
    assert.equal(
      concurrentConsumes.filter((token) => token !== null).length,
      1,
      "A token must be consumable exactly once under concurrency."
    );

    const expiredSecret = generateAuthSecret();
    const expiredToken = await createAuthToken(pool, {
      expiresAt: new Date(Date.now() + 60_000),
      purpose: "password_reset",
      tokenHash: hashAuthSecret(expiredSecret),
      userId: authUser.id,
    });
    await pool.query(
      `
        UPDATE "auth_tokens"
        SET
          "created_at" = clock_timestamp() - interval '2 hours',
          "expires_at" = clock_timestamp() - interval '1 hour'
        WHERE "id" = $1
      `,
      [expiredToken.id]
    );
    assert.equal(
      await consumeAuthToken(pool, {
        purpose: "password_reset",
        tokenHash: hashAuthSecret(expiredSecret),
      }),
      null,
      "An expired token must not be consumable."
    );

    await assert.rejects(
      pool.query(
        `
          INSERT INTO "sessions"
            ("user_id", "token_hash", "csrf_token_hash", "absolute_expires_at")
          VALUES ($1, 'not-a-sha256-hash', $2, clock_timestamp() + interval '1 hour')
        `,
        [authUser.id, hashAuthSecret(generateAuthSecret())]
      ),
      /sessions_token_hash_format|value too long/,
      "The database must reject malformed session token hashes."
    );

    const keepSecret = generateAuthSecret();
    const keepSession = await createSession(pool, {
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      csrfTokenHash: hashAuthSecret(generateAuthSecret()),
      deviceSummary: "integration-keep",
      tokenHash: hashAuthSecret(keepSecret),
      userId: authUser.id,
    });
    const dropSession = await createSession(pool, {
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      csrfTokenHash: hashAuthSecret(generateAuthSecret()),
      deviceSummary: "integration-drop",
      tokenHash: hashAuthSecret(generateAuthSecret()),
      userId: authUser.id,
    });
    assert.equal(
      await revokeSessionById(pool, {
        sessionId: dropSession.id,
        userId: authUser.id,
      }),
      true
    );
    assert.equal(
      await revokeSessionById(pool, {
        sessionId: dropSession.id,
        userId: authUser.id,
      }),
      false,
      "Revocation must be idempotent and report no second change."
    );
    const activeSessions = await listActiveSessions(pool, {
      idleCutoff: new Date(Date.now() - 60_000),
      userId: authUser.id,
    });
    assert.deepEqual(
      activeSessions.map((session) => session.id),
      [keepSession.id],
      "Only unrevoked, unexpired sessions may be listed."
    );
    assert.equal(
      await revokeUserSessions(pool, { userId: authUser.id }),
      1,
      "Revoking every session must count the remaining active one."
    );

    await redis.connect();
    await redis.set(`${redisPrefix}probe`, "isolated", "EX", 30);
    assert.equal(await redis.get(`${redisPrefix}probe`), "isolated");

    process.stdout.write(
      `${JSON.stringify({
        atomicOutbox: "verified",
        authLifecycle: "verified",
        concurrentClaims: claimedIds.length,
        deadLetters: metrics.deadLetter,
        event: "integration.completed",
        migrations: "applied",
        redis: "isolated",
        schedules: "verified",
        seedDomainRecords: 3,
        seedOutboxEvents: 1,
      })}\n`
    );
  } finally {
    await pool.end();
  }
} finally {
  if (redis.status !== "end") {
    if (redis.status === "ready") {
      await deleteRedisScope();
    }
    redis.disconnect();
  }

  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  await admin.end().catch(() => undefined);
}
