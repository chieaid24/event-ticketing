import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import pg from "pg";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";
const baseDatabaseUrl = process.env["DATABASE_URL"] ?? localDatabaseUrl;
const redisUrl = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
const scope = randomUUID().replaceAll("-", "");
const schema = `test_${scope}`;
const redisPrefix = `test:${scope}:`;
const scopedDatabaseUrl = new URL(baseDatabaseUrl);
scopedDatabaseUrl.searchParams.set("schema", schema);

const admin = new pg.Client({ connectionString: baseDatabaseUrl });
const database = new pg.Client({
  connectionString: scopedDatabaseUrl.toString(),
});
const redis = new Redis(redisUrl, {
  connectTimeout: 2_000,
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 0,
});
let adminConnected = false;

function runPrisma(args) {
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
          `Prisma exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`
        )
      );
    });
  });
}

async function deleteRedisScope() {
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

  await database.connect();
  await database.query(`SET search_path TO "${schema}"`);
  const result = await database.query(`
    SELECT
      (SELECT count(*)::int FROM "users") AS "users",
      (SELECT count(*)::int FROM "organizations") AS "organizations",
      (SELECT count(*)::int FROM "organization_memberships") AS "memberships"
  `);

  assert.deepEqual(result.rows, [
    {
      memberships: 1,
      organizations: 1,
      users: 1,
    },
  ]);

  await redis.connect();
  await redis.set(`${redisPrefix}probe`, "isolated", "EX", 30);
  assert.equal(await redis.get(`${redisPrefix}probe`), "isolated");

  process.stdout.write(
    `${JSON.stringify({
      event: "integration.completed",
      migrations: "applied",
      redis: "isolated",
      seedRecords: 3,
    })}\n`
  );
} finally {
  if (redis.status !== "end") {
    if (redis.status === "ready") {
      await deleteRedisScope();
    }
    redis.disconnect();
  }
  await database.end().catch(() => undefined);

  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  await admin.end().catch(() => undefined);
}
