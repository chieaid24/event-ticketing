import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import {
  createDatabasePool,
  createOutboxRepository,
} from "@event-ticketing/database";
import { loadWorkerConfig } from "@event-ticketing/config";

import { createAuthEmailHandlers } from "./auth-email-handlers.js";
import { workerHandlers } from "./handlers.js";
import {
  createHoldExpirationHandlers,
  HOLD_EXPIRATION_SWEEP_BATCH_LIMIT,
  HOLD_EXPIRATION_SWEEP_INTERVAL_SECONDS,
  HOLD_EXPIRATION_SWEEP_TOPIC,
} from "./hold-expiration-handlers.js";
import { createSmtpEmailer } from "./mailer.js";
import { createOutboxProcessor } from "./outbox-processor.js";
import { createWorkerRuntime } from "./runtime.js";

async function startWorker(): Promise<void> {
  const config = loadWorkerConfig();
  const database = createDatabasePool(config.databaseUrl, {
    maxConnections: 5,
  });
  const repository = createOutboxRepository(database);
  const emailer = createSmtpEmailer({
    from: config.mailFrom,
    smtpUrl: config.smtpUrl,
  });
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  const processor = createOutboxProcessor({
    batchSize: config.outboxBatchSize,
    handlers: {
      ...workerHandlers,
      ...createHoldExpirationHandlers({
        batchLimit: HOLD_EXPIRATION_SWEEP_BATCH_LIMIT,
        pool: database,
      }),
      ...createAuthEmailHandlers({
        emailer,
        executor: database,
        resetTokenTtlSeconds: config.resetTokenTtlSeconds,
        verificationTokenTtlSeconds: config.verificationTokenTtlSeconds,
        webBaseUrl: config.webBaseUrl,
      }),
    },
    leaseMs: config.outboxLeaseMs,
    repository,
    retryBaseDelayMs: config.outboxRetryBaseMs,
    retryMaximumDelayMs: config.outboxRetryMaximumMs,
    workerId,
  });
  const runtime = createWorkerRuntime({
    log: (entry) => {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    },
    pollIntervalMs: config.outboxPollIntervalMs,
    processor,
  });
  let stopping = false;

  async function stop(signal: NodeJS.Signals): Promise<void> {
    if (stopping) {
      return;
    }

    stopping = true;
    const forcedExit = setTimeout(() => {
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forcedExit.unref();

    await runtime.stop();
    emailer.close();
    await database.end();
    clearTimeout(forcedExit);
    process.stdout.write(
      `${JSON.stringify({ event: "worker.shutdown", service: "worker", signal })}\n`
    );
  }

  const handleSigint = (): void => {
    void stop("SIGINT");
  };
  const handleSigterm = (): void => {
    void stop("SIGTERM");
  };

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  try {
    await database.query("SELECT 1");
    // Recurring reconciliation sweep that reclaims expired holds.
    await repository.upsertSchedule({
      intervalSeconds: HOLD_EXPIRATION_SWEEP_INTERVAL_SECONDS,
      name: "hold-expiration-sweep",
      nextRunAt: new Date(),
      payload: {},
      topic: HOLD_EXPIRATION_SWEEP_TOPIC,
    });
    runtime.start();
  } catch (error) {
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);
    await database.end().catch(() => undefined);
    throw error;
  }
}

void startWorker().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      event: "worker.startup.failed",
      service: "worker",
    })}\n`
  );
  process.exitCode = 1;
});
