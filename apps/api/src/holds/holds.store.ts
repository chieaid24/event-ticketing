import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  createAssignedSeatHold,
  createDatabasePool,
  withDatabaseTransaction,
  type AssignedSeatHoldRecord,
  type CreateAssignedSeatHoldInput,
} from "@event-ticketing/database";

import type { HoldExpiryMirror } from "./hold-expiry-mirror.js";

export interface HoldsStore {
  createAssignedSeatHold(
    input: CreateAssignedSeatHoldInput
  ): Promise<AssignedSeatHoldRecord>;
}

export class PgHoldsStore implements HoldsStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(
    databaseUrl: string,
    private readonly mirror: HoldExpiryMirror
  ) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async createAssignedSeatHold(
    input: CreateAssignedSeatHoldInput
  ): Promise<AssignedSeatHoldRecord> {
    const hold = await withDatabaseTransaction(this.pool, (transaction) =>
      createAssignedSeatHold(transaction, input)
    );
    // Mirror expiry only after commit; the mirror is advisory, so its own
    // failure is swallowed and never undoes a committed hold.
    await this.mirror.set(hold.id, hold.expiresAt);
    return hold;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
