import type { OutboxCycleResult, OutboxProcessor } from "./outbox-processor.js";

export type WorkerLogEntry =
  | {
      event: "worker.started" | "worker.stopped";
      service: "worker";
    }
  | ({
      event: "outbox.cycle.completed";
      service: "worker";
    } & OutboxCycleResult)
  | {
      errorCode: "outbox_cycle_failed";
      event: "outbox.cycle.failed";
      service: "worker";
    };

export type WorkerLog = (entry: WorkerLogEntry) => void;

export interface WorkerRuntime {
  start(): void;
  stop(): Promise<void>;
}

export function createWorkerRuntime(input: {
  log: WorkerLog;
  pollIntervalMs: number;
  processor: OutboxProcessor;
}): WorkerRuntime {
  let pollTimer: NodeJS.Timeout | undefined;
  let lastMetricsSignature: string | undefined;
  let started = false;
  let stopping = false;

  function shouldLog(result: OutboxCycleResult): boolean {
    const signature = JSON.stringify({
      deadLetter: result.metrics.deadLetter,
      pendingDelayed: result.metrics.pendingDelayed,
      pendingReady: result.metrics.pendingReady,
      processing: result.metrics.processing,
      retrying: result.metrics.retrying,
    });
    const changed = signature !== lastMetricsSignature;
    lastMetricsSignature = signature;

    return (
      changed ||
      result.claimed > 0 ||
      result.deadLettered > 0 ||
      result.materialized > 0 ||
      result.retried > 0
    );
  }

  function schedule(delayMs: number): void {
    pollTimer = setTimeout(() => {
      void poll();
    }, delayMs);
  }

  async function poll(): Promise<void> {
    if (stopping) {
      return;
    }

    try {
      const result = await input.processor.processOnce();

      if (shouldLog(result)) {
        input.log({
          event: "outbox.cycle.completed",
          service: "worker",
          ...result,
        });
      }
    } catch {
      input.log({
        errorCode: "outbox_cycle_failed",
        event: "outbox.cycle.failed",
        service: "worker",
      });
    } finally {
      if (!stopping) {
        schedule(input.pollIntervalMs);
      }
    }
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      input.log({
        event: "worker.started",
        service: "worker",
      });
      schedule(0);
    },
    async stop() {
      if (!started || stopping) {
        return;
      }

      stopping = true;

      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }

      await input.processor.stop();
      started = false;
      input.log({
        event: "worker.stopped",
        service: "worker",
      });
    },
  };
}
