import { expireDueHolds } from "@event-ticketing/database";

import type { OutboxHandler } from "./outbox-processor.js";

export const HOLD_EXPIRATION_SWEEP_TOPIC = "hold.expiration.sweep";
export const HOLD_EXPIRATION_SWEEP_INTERVAL_SECONDS = 60;
// Reconciliation throughput per sweep, decoupled from the outbox batch size so
// an expiry burst drains in one pass rather than over many polls.
export const HOLD_EXPIRATION_SWEEP_BATCH_LIMIT = 500;

type HoldExpirationPool = Parameters<typeof expireDueHolds>[0];

export interface HoldExpirationHandlerDependencies {
  batchLimit: number;
  pool: HoldExpirationPool;
  // Injectable for tests; defaults to the database sweep.
  sweep?: (
    pool: HoldExpirationPool,
    input: { limit: number }
  ) => Promise<number>;
}

/**
 * Reconciliation sweep: returns reserved quantity for holds past their database
 * expiry. Idempotent and at-least-once safe, so redelivery only re-sweeps.
 */
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
