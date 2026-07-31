import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import pg from "pg";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";
const databaseUrl = process.env.DATABASE_URL ?? localDatabaseUrl;
const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
const restoreDatabase = `event_ticketing_restore_${nonce}`;
const backupPath = `/tmp/${restoreDatabase}.dump`;

function compose(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", ...args], {
      ...options,
      stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(output.trim());
        return;
      }
      reject(
        new Error(
          `docker compose exited with ${
            signal ? `signal ${signal}` : `code ${String(code)}`
          }.`
        )
      );
    });
  });
}

const source = new pg.Client({ connectionString: databaseUrl });
let restoreCreated = false;

try {
  await source.connect();
  const migrationCount = await source.query(
    'SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL'
  );
  const sourceCounts = await source.query(`
    SELECT
      (SELECT count(*)::int FROM "users") AS users,
      (SELECT count(*)::int FROM "organizations") AS organizations,
      (SELECT count(*)::int FROM "events") AS events,
      (SELECT count(*)::int FROM "orders") AS orders,
      (SELECT count(*)::int FROM "tickets") AS tickets,
      (SELECT count(*)::int FROM "refunds") AS refunds
  `);

  await source.query("BEGIN");
  await source.query(
    `INSERT INTO "organizations" ("id", "name", "slug")
     VALUES ($1, $2, $3)`,
    [randomUUID(), "Recovery rollback probe", `recovery-rollback-${nonce}`]
  );
  await source.query("ROLLBACK");
  const rollbackProbe = await source.query(
    'SELECT count(*)::int AS count FROM "organizations" WHERE "slug" = $1',
    [`recovery-rollback-${nonce}`]
  );

  await compose([
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "event_ticketing",
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    backupPath,
    "event_ticketing",
  ]);
  await compose([
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    "event_ticketing",
    restoreDatabase,
  ]);
  restoreCreated = true;
  await compose([
    "exec",
    "-T",
    "postgres",
    "pg_restore",
    "-U",
    "event_ticketing",
    "--dbname",
    restoreDatabase,
    "--no-owner",
    "--no-privileges",
    backupPath,
  ]);

  const restoredUrl = new URL(databaseUrl);
  restoredUrl.pathname = `/${restoreDatabase}`;
  restoredUrl.searchParams.delete("schema");
  const restored = new pg.Client({ connectionString: restoredUrl.toString() });
  await restored.connect();
  const restoredCounts = await restored.query(`
    SELECT
      (SELECT count(*)::int FROM "users") AS users,
      (SELECT count(*)::int FROM "organizations") AS organizations,
      (SELECT count(*)::int FROM "events") AS events,
      (SELECT count(*)::int FROM "orders") AS orders,
      (SELECT count(*)::int FROM "tickets") AS tickets,
      (SELECT count(*)::int FROM "refunds") AS refunds
  `);
  await restored.end();

  if (
    JSON.stringify(sourceCounts.rows[0]) !==
    JSON.stringify(restoredCounts.rows[0])
  ) {
    throw new Error("Restored row counts do not match the source backup.");
  }
  if (rollbackProbe.rows[0]?.count !== 0) {
    throw new Error("The transaction rollback probe left a row behind.");
  }

  process.stdout.write(
    `${JSON.stringify({
      backupRestore: "verified",
      event: "recovery.completed",
      migrationsApplied: migrationCount.rows[0]?.count,
      restoredCounts: restoredCounts.rows[0],
      rollback: "verified",
    })}\n`
  );
} finally {
  await source.end().catch(() => undefined);
  if (restoreCreated) {
    await compose([
      "exec",
      "-T",
      "postgres",
      "dropdb",
      "-U",
      "event_ticketing",
      "--force",
      "--if-exists",
      restoreDatabase,
    ]).catch(() => undefined);
  }
  await compose(["exec", "-T", "postgres", "unlink", backupPath]).catch(
    () => undefined
  );
}
