import { describe, expect, it } from "vitest";

import {
  authTokenSchema,
  loginRequestSchema,
  registerRequestSchema,
} from "./auth.js";

describe("registerRequestSchema", () => {
  it("normalizes the email to trimmed lowercase", () => {
    const parsed = registerRequestSchema.parse({
      email: "  Customer@Example.TEST ",
      password: "a-long-enough-password",
    });

    expect(parsed.email).toBe("customer@example.test");
  });

  it("rejects passwords shorter than 12 characters", () => {
    const result = registerRequestSchema.safeParse({
      email: "customer@example.test",
      password: "elevenchars",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = registerRequestSchema.safeParse({
      email: "customer@example.test",
      isAdmin: true,
      password: "a-long-enough-password",
    });

    expect(result.success).toBe(false);
  });
});

describe("loginRequestSchema", () => {
  it("accepts any non-empty password so legacy lengths can sign in", () => {
    const result = loginRequestSchema.safeParse({
      email: "customer@example.test",
      password: "short",
    });

    expect(result.success).toBe(true);
  });
});

describe("authTokenSchema", () => {
  it("accepts base64url secrets and rejects other shapes", () => {
    expect(authTokenSchema.safeParse("A".repeat(43)).success).toBe(true);
    expect(authTokenSchema.safeParse("too-short").success).toBe(false);
    expect(authTokenSchema.safeParse(`${"A".repeat(42)}!`).success).toBe(false);
  });
});
