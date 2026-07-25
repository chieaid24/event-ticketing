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

  const anonymousMe = await fetch(`${baseUrl}/auth/me`, {
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(anonymousMe.status, 401);
  assert.deepEqual((await anonymousMe.json()).code, "unauthenticated");

  const invalidRegister = await fetch(`${baseUrl}/auth/register`, {
    body: JSON.stringify({ email: "not-an-email", password: "short" }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(invalidRegister.status, 400);
  assert.equal((await invalidRegister.json()).code, "invalid_request");

  const loginAttempt = (email, password) =>
    fetch(`${baseUrl}/auth/login`, {
      body: JSON.stringify({ email, password }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });

  const unknownUser = await loginAttempt(
    "smoke-nobody@example.test",
    "a-wrong-password"
  );
  const wrongPassword = await loginAttempt(
    "owner@example.test",
    "a-wrong-password"
  );
  assert.equal(unknownUser.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(
    await unknownUser.json(),
    await wrongPassword.json(),
    "Login failures must not reveal whether the email exists."
  );

  const login = await loginAttempt("owner@example.test", "owner-password-dev");
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(loginBody.user.email, "owner@example.test");
  const setCookies = login.headers.getSetCookie();
  const sessionCookie = setCookies.find((value) =>
    value.startsWith("et_session=")
  );
  const csrfCookie = setCookies.find((value) => value.startsWith("et_csrf="));
  assert.ok(sessionCookie, "Login must set the session cookie.");
  assert.ok(csrfCookie, "Login must set the CSRF cookie.");
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.doesNotMatch(csrfCookie, /HttpOnly/);
  const cookieHeader = [sessionCookie, csrfCookie]
    .map((value) => value.split(";")[0])
    .join("; ");
  const csrfToken = csrfCookie.split(";")[0].split("=")[1];

  const me = await fetch(`${baseUrl}/auth/me`, {
    headers: { cookie: cookieHeader },
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, "owner@example.test");

  const sessions = await fetch(`${baseUrl}/auth/sessions`, {
    headers: { cookie: cookieHeader },
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(sessions.status, 200);
  const sessionsBody = await sessions.json();
  assert.ok(sessionsBody.sessions.length >= 1);
  assert.equal(
    sessionsBody.sessions.filter((session) => session.current).length,
    1
  );

  const csrfMissing = await fetch(`${baseUrl}/auth/logout`, {
    headers: { cookie: cookieHeader },
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(csrfMissing.status, 403);
  assert.equal((await csrfMissing.json()).code, "invalid_csrf_token");

  const untrustedOrigin = await fetch(`${baseUrl}/auth/logout`, {
    headers: {
      cookie: cookieHeader,
      origin: "https://evil.example.com",
      "x-csrf-token": csrfToken,
    },
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(untrustedOrigin.status, 403);
  assert.equal((await untrustedOrigin.json()).code, "untrusted_origin");

  const logout = await fetch(`${baseUrl}/auth/logout`, {
    headers: { cookie: cookieHeader, "x-csrf-token": csrfToken },
    method: "POST",
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(logout.status, 200);
  const loggedOutMe = await fetch(`${baseUrl}/auth/me`, {
    headers: { cookie: cookieHeader },
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(loggedOutMe.status, 401, "Logout must revoke the session.");

  const smokeEmail = `smoke-${String(Date.now())}@example.test`;
  const register = await fetch(`${baseUrl}/auth/register`, {
    body: JSON.stringify({
      email: smokeEmail,
      password: "a-smoke-test-password",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(register.status, 202);
  const unverifiedLogin = await loginAttempt(
    smokeEmail,
    "a-smoke-test-password"
  );
  assert.equal(unverifiedLogin.status, 403);
  assert.equal((await unverifiedLogin.json()).code, "email_not_verified");

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
      auth: "verified",
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
