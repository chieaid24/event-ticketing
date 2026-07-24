export interface DatabaseConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

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
