import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./passwords.js";

describe("passwords", () => {
  it("hashes with argon2id and verifies the original password", async () => {
    const hash = await hashPassword("a-long-enough-password");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("a-long-enough-password");
    await expect(verifyPassword(hash, "a-long-enough-password")).resolves.toBe(
      true
    );
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("a-long-enough-password");

    await expect(verifyPassword(hash, "another-long-password")).resolves.toBe(
      false
    );
  });

  it("rejects when no hash exists but still runs a verification", async () => {
    await expect(verifyPassword(null, "any-password-value")).resolves.toBe(
      false
    );
  });

  it("rejects an unparsable stored hash without throwing", async () => {
    await expect(verifyPassword("not-a-hash", "any-password")).resolves.toBe(
      false
    );
  });
});
