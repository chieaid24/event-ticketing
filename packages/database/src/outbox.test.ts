import { describe, expect, it, vi } from "vitest";

import {
  createDatabasePool,
  enqueueOutboxEvent,
  OutboxInputError,
  type DatabaseExecutor,
} from "./outbox.js";

describe("outbox input", () => {
  it("rejects unsafe topics before querying PostgreSQL", async () => {
    const executor: DatabaseExecutor = {
      query: vi.fn(),
    };

    await expect(
      enqueueOutboxEvent(executor, {
        payload: {},
        topic: "Organization Created",
      })
    ).rejects.toBeInstanceOf(OutboxInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("rejects non-JSON payloads before querying PostgreSQL", async () => {
    const executor: DatabaseExecutor = {
      query: vi.fn(),
    };

    await expect(
      enqueueOutboxEvent(executor, {
        payload: undefined,
        topic: "organization.created",
      })
    ).rejects.toBeInstanceOf(OutboxInputError);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it("creates a disconnected schema-scoped pool", async () => {
    const pool = createDatabasePool(
      "postgresql://example-user:example-password@127.0.0.1:1/example?schema=tenant_test",
      { connectionTimeoutMs: 100, maxConnections: 1 }
    );

    await expect(pool.end()).resolves.toBeUndefined();
  });
});
