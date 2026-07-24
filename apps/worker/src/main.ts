import { loadWorkerConfig } from "@event-ticketing/config";

import { createWorkerRuntime } from "./runtime.js";

const config = loadWorkerConfig();
const runtime = createWorkerRuntime((entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
});
let stopping = false;

async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  const forcedExit = setTimeout(() => {
    process.exitCode = 1;
  }, config.shutdownTimeoutMs);
  forcedExit.unref();

  await runtime.stop();
  clearTimeout(forcedExit);
  process.stdout.write(
    `${JSON.stringify({ event: "worker.shutdown", service: "worker", signal })}\n`
  );
}

process.once("SIGINT", () => {
  void stop("SIGINT");
});
process.once("SIGTERM", () => {
  void stop("SIGTERM");
});

runtime.start();
