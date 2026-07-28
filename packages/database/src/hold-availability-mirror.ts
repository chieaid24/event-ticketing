/**
 * Advisory Redis mirror of hold expiry. PostgreSQL stays authoritative for
 * inventory (invariant: Redis never overrides Postgres); this only accelerates
 * client-facing countdowns and availability hints. The client is injected as a
 * structural interface so this package keeps no Redis runtime dependency.
 */

export interface HoldExpiryMirrorClient {
  del(key: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
}

export interface HoldExpiryMirrorInput {
  holdId: string;
  prefix: string;
}

export function holdExpiryKey(prefix: string, holdId: string): string {
  return `${prefix}hold-expiry:${holdId}`;
}

/**
 * Mirrors a hold's expiry as a TTL key. Returns false and clears the key when
 * the hold has already expired, so a stale mirror never outlives the database.
 */
export async function mirrorHoldExpiry(
  client: HoldExpiryMirrorClient,
  input: HoldExpiryMirrorInput & { expiresAt: Date; now?: Date }
): Promise<boolean> {
  const key = holdExpiryKey(input.prefix, input.holdId);
  const ttlMs = input.expiresAt.getTime() - (input.now ?? new Date()).getTime();

  if (ttlMs <= 0) {
    await client.del(key);
    return false;
  }

  await client.set(key, input.expiresAt.toISOString(), "PX", ttlMs);
  return true;
}

/** Clears a hold's expiry mirror once it is consumed, cancelled, or expired. */
export async function clearHoldExpiry(
  client: HoldExpiryMirrorClient,
  input: HoldExpiryMirrorInput
): Promise<void> {
  await client.del(holdExpiryKey(input.prefix, input.holdId));
}

/** Reads the mirrored expiry, or null when Redis has dropped it. */
export async function readHoldExpiry(
  client: HoldExpiryMirrorClient,
  input: HoldExpiryMirrorInput
): Promise<Date | null> {
  const value = await client.get(holdExpiryKey(input.prefix, input.holdId));
  return value === null ? null : new Date(value);
}
