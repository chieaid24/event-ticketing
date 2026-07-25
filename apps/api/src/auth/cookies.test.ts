import { describe, expect, it } from "vitest";

import {
  buildClearedSessionCookies,
  buildSessionCookies,
  parseCookieHeader,
} from "./cookies.js";

describe("session cookies", () => {
  it("marks the session cookie HttpOnly and the CSRF cookie readable", () => {
    const [session, csrf] = buildSessionCookies(
      { csrfSecret: "csrf-secret-value", sessionSecret: "session-secret" },
      { maxAgeSeconds: 3_600, secure: true }
    );

    expect(session).toContain("et_session=session-secret");
    expect(session).toContain("HttpOnly");
    expect(session).toContain("Secure");
    expect(session).toContain("SameSite=Lax");
    expect(session).toContain("Max-Age=3600");
    expect(session).toContain("Path=/");

    expect(csrf).toContain("et_csrf=csrf-secret-value");
    expect(csrf).not.toContain("HttpOnly");
    expect(csrf).toContain("Secure");
    expect(csrf).toContain("SameSite=Lax");
  });

  it("omits the Secure attribute when disabled for local development", () => {
    const [session] = buildSessionCookies(
      { csrfSecret: "csrf-secret-value", sessionSecret: "session-secret" },
      { maxAgeSeconds: 60, secure: false }
    );

    expect(session).not.toContain("Secure");
  });

  it("clears both cookies with an immediate expiry", () => {
    const cleared = buildClearedSessionCookies({ secure: false });

    expect(cleared).toHaveLength(2);
    for (const cookie of cleared) {
      expect(cookie).toContain("Max-Age=0");
    }
  });

  it("parses a cookie header and tolerates a missing one", () => {
    expect(parseCookieHeader("et_session=abc; other=1")).toMatchObject({
      et_session: "abc",
    });
    expect(parseCookieHeader(undefined)).toEqual({});
  });
});
