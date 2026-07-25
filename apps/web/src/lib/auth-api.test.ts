import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthApiError,
  login,
  readCsrfToken,
  registerAccount,
} from "./auth-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerAccount", () => {
  it("sends credentials and parses the accepted contract", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(202, { status: "accepted" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await registerAccount("http://api.test", {
      email: "customer@example.test",
      password: "a-long-enough-password",
    });

    expect(result).toEqual({ status: "accepted" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/auth/register");
    expect(init.credentials).toBe("include");
  });

  it("surfaces the API error contract as an AuthApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, {
          code: "invalid_credentials",
          message: "Email or password is incorrect.",
        })
      )
    );

    await expect(
      login("http://api.test", {
        email: "customer@example.test",
        password: "a-wrong-password",
      })
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      name: "AuthApiError",
    });
  });

  it("falls back to a generic error for malformed failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 }))
    );

    await expect(
      registerAccount("http://api.test", {
        email: "customer@example.test",
        password: "a-long-enough-password",
      })
    ).rejects.toMatchObject({ code: "unknown_error" });
  });

  it("maps network failures to a stable error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const failure = registerAccount("http://api.test", {
      email: "customer@example.test",
      password: "a-long-enough-password",
    });
    await expect(failure).rejects.toBeInstanceOf(AuthApiError);
    await expect(failure).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("readCsrfToken", () => {
  it("reads the CSRF cookie and ignores others", () => {
    vi.stubGlobal("document", {
      cookie: "other=1; et_csrf=the-csrf-secret; another=2",
    });

    expect(readCsrfToken()).toBe("the-csrf-secret");
  });

  it("returns undefined when the cookie is absent", () => {
    vi.stubGlobal("document", { cookie: "other=1" });

    expect(readCsrfToken()).toBeUndefined();
  });
});
