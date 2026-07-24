import { describe, expect, it, vi } from "vitest";

import { type DatabaseConnection, withDatabaseConnection } from "./index.js";

describe("withDatabaseConnection", () => {
  it("disconnects after a successful operation", async () => {
    const connection: DatabaseConnection = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      withDatabaseConnection(connection, async () => "done")
    ).resolves.toBe("done");
    expect(connection.connect).toHaveBeenCalledOnce();
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects after an operation fails", async () => {
    const connection: DatabaseConnection = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      withDatabaseConnection(connection, async () => {
        throw new Error("operation failed");
      })
    ).rejects.toThrow("operation failed");
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });
});
