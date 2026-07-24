import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve an API smoke-test port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function captureLines(stream) {
  const lines = [];
  let pending = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    pending += chunk;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    lines.push(...parts.filter(Boolean));
  });

  return {
    flush() {
      if (pending) {
        lines.push(pending);
        pending = "";
      }
      return lines;
    },
  };
}

async function waitForResponse(url) {
  let lastError;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(500),
      });

      if (response.ok) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError ?? new Error("API smoke test timed out.");
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("API did not stop within 5 seconds."));
    }, 5_000);

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${String(port)}`;
const child = spawn(process.execPath, ["apps/api/dist/main.js"], {
  env: {
    ...process.env,
    API_HOST: "127.0.0.1",
    API_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const standardOutput = captureLines(child.stdout);
const standardError = captureLines(child.stderr);

try {
  const liveResponse = await waitForResponse(`${baseUrl}/health/live`);
  assert.equal(liveResponse.status, 200);
  assert.equal(liveResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await liveResponse.json(), {
    service: "api",
    status: "live",
  });

  const readyResponse = await fetch(`${baseUrl}/health/ready`, {
    signal: AbortSignal.timeout(3_000),
  });
  assert.equal(readyResponse.status, 200);
  assert.deepEqual(await readyResponse.json(), {
    checks: {
      database: "up",
      redis: "up",
    },
    service: "api",
    status: "ready",
  });

  const requestId = "smoke-request-42";
  const statusResponse = await fetch(`${baseUrl}/status`, {
    headers: {
      "x-request-id": requestId,
    },
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.headers.get("x-request-id"), requestId);

  await new Promise((resolve) => setTimeout(resolve, 50));
  const logs = standardOutput
    .flush()
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === "http.request.completed");
  assert.ok(
    logs.some(
      (entry) =>
        entry.path === "/status" &&
        entry.request_id === requestId &&
        entry.status_code === 200
    )
  );

  process.stdout.write(
    `${JSON.stringify({
      event: "api.smoke.completed",
      health: "ready",
      requestId: "propagated",
    })}\n`
  );
} finally {
  child.kill("SIGTERM");
  const exit = await waitForExit(child);
  const errors = standardError.flush();

  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(
    exit.code === 0 || exit.signal === "SIGTERM",
    `API exited with ${JSON.stringify(exit)}.`
  );
}
