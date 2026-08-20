import { expireDueHolds } from "@event-ticketing/database";

import type { OutboxHandler } from "./outbox-processor.js";

export const HOLD_EXPIRATION_SWEEP_TOPIC = "hold.expiration.sweep";
export const HOLD_EXPIRATION_SWEEP_INTERVAL_SECONDS = 60;
// independent batch size drains expiry bursts
export const HOLD_EXPIRATION_SWEEP_BATCH_LIMIT = 500;

type HoldExpirationPool = Parameters<typeof expireDueHolds>[0];

export interface HoldExpirationHandlerDependencies {
  batchLimit: number;
  pool: HoldExpirationPool;
  sweep?: (
    pool: HoldExpirationPool,
    input: { limit: number }
  ) => Promise<number>;
}

// idempotent sweep of expired holds; redelivery just re-sweeps
export function createHoldExpirationHandlers(
  dependencies: HoldExpirationHandlerDependencies
): Record<string, OutboxHandler> {
  const sweep = dependencies.sweep ?? expireDueHolds;

  return {
    [HOLD_EXPIRATION_SWEEP_TOPIC]: async () => {
      await sweep(dependencies.pool, { limit: dependencies.batchLimit });
    },
  };
}
