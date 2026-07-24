export type WorkerLog = (entry: {
  event: "worker.started" | "worker.stopped";
  service: "worker";
}) => void;

export interface WorkerRuntime {
  start(): void;
  stop(): Promise<void>;
}

export function createWorkerRuntime(log: WorkerLog): WorkerRuntime {
  let keepAliveTimer: NodeJS.Timeout | undefined;

  return {
    start() {
      if (keepAliveTimer) {
        return;
      }

      keepAliveTimer = setInterval(() => undefined, 60_000);
      log({
        event: "worker.started",
        service: "worker",
      });
    },
    async stop() {
      if (!keepAliveTimer) {
        return;
      }

      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
      log({
        event: "worker.stopped",
        service: "worker",
      });
    },
  };
}
