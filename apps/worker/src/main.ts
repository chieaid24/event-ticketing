import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import {
  createDatabasePool,
  createOutboxRepository,
} from "@event-ticketing/database";
import { loadWorkerConfig } from "@event-ticketing/config";

import { workerHandlers } from "./handlers.js";
import { createOutboxProcessor } from "./outbox-processor.js";
import { createWorkerRuntime } from "./runtime.js";

async function startWorker(): Promise<void> {
  const config = loadWorkerConfig();
  const database = createDatabasePool(config.databaseUrl, {
    maxConnections: 5,
  });
  const repository = createOutboxRepository(database);
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  const processor = createOutboxProcessor({
    batchSize: config.outboxBatchSize,
    handlers: workerHandlers,
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
