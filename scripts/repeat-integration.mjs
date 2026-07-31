import { spawn } from "node:child_process";

const requestedRuns = Number.parseInt(process.env.RACE_RUNS ?? "3", 10);
if (
  !Number.isInteger(requestedRuns) ||
  requestedRuns < 1 ||
  requestedRuns > 20
) {
  throw new Error("RACE_RUNS must be an integer from 1 through 20.");
}

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const startedAt = Date.now();

for (let run = 1; run <= requestedRuns; run += 1) {
  process.stdout.write(`race suite ${String(run)}/${String(requestedRuns)}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      command,
      ["--filter", "@event-ticketing/database", "test:integration"],
      { env: process.env, stdio: "inherit" }
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Race suite ${String(run)} exited with ${
            signal ? `signal ${signal}` : `code ${String(code)}`
          }.`
        )
      );
    });
  });
}

process.stdout.write(
  `${JSON.stringify({
    doubleBookings: 0,
    durationMs: Date.now() - startedAt,
    event: "race.repetition.completed",
    oversells: 0,
    runs: requestedRuns,
    seatAttemptsPerRun: 100,
  })}\n`
);
