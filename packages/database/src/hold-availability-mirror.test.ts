import { describe, expect, it, vi } from "vitest";

import {
  clearHoldExpiry,
  holdExpiryKey,
  mirrorHoldExpiry,
  readHoldExpiry,
  type HoldExpiryMirrorClient,
} from "./index.js";

function fakeClient(): HoldExpiryMirrorClient & {
  del: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  return {
    del: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  };
}

describe("hold expiry mirror", () => {
  const prefix = "app:";
  const holdId = "55555555-5555-4555-8555-555555555555";

  it("writes a TTL key sized to the remaining lifetime", async () => {
    const client = fakeClient();
    const now = new Date("2026-07-28T00:00:00.000Z");
    const expiresAt = new Date("2026-07-28T00:10:00.000Z");

    const mirrored = await mirrorHoldExpiry(client, {
      expiresAt,
      holdId,
      now,
      prefix,
    });

    expect(mirrored).toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      holdExpiryKey(prefix, holdId),
      expiresAt.toISOString(),
      "PX",
      600_000
    );
  });

  it("clears rather than writes an already-expired hold", async () => {
    const client = fakeClient();
    const now = new Date("2026-07-28T00:10:00.000Z");
    const expiresAt = new Date("2026-07-28T00:00:00.000Z");

    const mirrored = await mirrorHoldExpiry(client, {
      expiresAt,
      holdId,
      now,
      prefix,
    });

    expect(mirrored).toBe(false);
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).toHaveBeenCalledWith(holdExpiryKey(prefix, holdId));
  });

  it("clears a mirror by key", async () => {
    const client = fakeClient();
    await clearHoldExpiry(client, { holdId, prefix });
    expect(client.del).toHaveBeenCalledWith(holdExpiryKey(prefix, holdId));
  });

  it("reads back a stored expiry, or null when dropped", async () => {
    const client = fakeClient();
    const expiresAt = new Date("2026-07-28T00:10:00.000Z");
    client.get.mockResolvedValueOnce(expiresAt.toISOString());

    expect(await readHoldExpiry(client, { holdId, prefix })).toEqual(expiresAt);
    expect(await readHoldExpiry(client, { holdId, prefix })).toBeNull();
  });
});
