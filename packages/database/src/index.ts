import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export * from "./auth.js";
export * from "./discovery.js";
export * from "./events.js";
export * from "./hold-availability-mirror.js";
export * from "./holds.js";
export * from "./orders.js";
export * from "./organizations.js";
export * from "./outbox.js";
export * from "./tickets.js";
export * from "./venues.js";

export interface DatabaseConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface DatabaseClientOptions {
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxConnections?: number;
}

export function createDatabaseClient(
  databaseUrl: string,
  options: DatabaseClientOptions = {}
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 300_000,
    max: options.maxConnections ?? 10,
  });

  return new PrismaClient({ adapter });
}

export type { PrismaClient };

export async function withDatabaseConnection<T>(
  connection: DatabaseConnection,
  operation: () => Promise<T>
): Promise<T> {
  await connection.connect();

  try {
    return await operation();
  } finally {
    await connection.disconnect();
  }
}
