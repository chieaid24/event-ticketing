// advisory redis mirror of hold expiry; postgres authoritative, client injected so no redis dep

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

// ttl mirror clears expired values to avoid stale advice
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

// clear hold expiry mirror once consumed/cancelled/expired
export async function clearHoldExpiry(
  client: HoldExpiryMirrorClient,
  input: HoldExpiryMirrorInput
): Promise<void> {
  await client.del(holdExpiryKey(input.prefix, input.holdId));
}

// read mirrored expiry, null if redis dropped it
export async function readHoldExpiry(
  client: HoldExpiryMirrorClient,
  input: HoldExpiryMirrorInput
): Promise<Date | null> {
  const value = await client.get(holdExpiryKey(input.prefix, input.holdId));
  return value === null ? null : new Date(value);
}
