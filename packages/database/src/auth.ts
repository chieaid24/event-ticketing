import { createHash, randomBytes } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "./outbox.js";

const tokenHashPattern = /^[0-9a-f]{64}$/;

export type AuthTokenPurpose = "email_verification" | "password_reset";

export function generateAuthSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAuthSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface AuthUserRow extends QueryResultRow {
  createdAt: Date;
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  passwordHash: string | null;
  platformRole: "customer" | "admin";
  status: "pending" | "active" | "suspended" | "disabled";
}

export interface SessionRow extends QueryResultRow {
  absoluteExpiresAt: Date;
  createdAt: Date;
  csrfTokenHash: string;
  deviceSummary: string;
  id: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
  userId: string;
}

export interface AuthTokenRow extends QueryResultRow {
  consumedAt: Date | null;
  expiresAt: Date;
  id: string;
  purpose: AuthTokenPurpose;
  userId: string;
}

export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthInputError";
  }
}

const userColumns = `
  "id",
  "email",
  "password_hash" AS "passwordHash",
  "platform_role" AS "platformRole",
  "status",
  "email_verified_at" AS "emailVerifiedAt",
  "created_at" AS "createdAt"
`;

const sessionColumns = `
  "id",
  "user_id" AS "userId",
  "token_hash" AS "tokenHash",
  "csrf_token_hash" AS "csrfTokenHash",
  "device_summary" AS "deviceSummary",
  "created_at" AS "createdAt",
  "last_seen_at" AS "lastSeenAt",
  "absolute_expires_at" AS "absoluteExpiresAt",
  "revoked_at" AS "revokedAt"
`;

function assertTokenHash(tokenHash: string): void {
  if (!tokenHashPattern.test(tokenHash)) {
    throw new AuthInputError("The token hash must be 64 lowercase hex chars.");
  }
}

export async function findUserByEmail(
  executor: DatabaseExecutor,
  email: string
): Promise<AuthUserRow | null> {
  const result = await executor.query<AuthUserRow>(
    `SELECT ${userColumns} FROM "users" WHERE "email" = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function findUserById(
  executor: DatabaseExecutor,
  userId: string
): Promise<AuthUserRow | null> {
  const result = await executor.query<AuthUserRow>(
    `SELECT ${userColumns} FROM "users" WHERE "id" = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function createUser(
  executor: DatabaseExecutor,
  input: { email: string; passwordHash: string }
): Promise<AuthUserRow | null> {
  const result = await executor.query<AuthUserRow>(
    `INSERT INTO "users" ("email", "password_hash")
     VALUES ($1, $2)
     ON CONFLICT ("email") DO NOTHING
     RETURNING ${userColumns}`,
    [input.email, input.passwordHash]
  );
  return result.rows[0] ?? null;
}

export async function markUserEmailVerified(
  executor: DatabaseExecutor,
  userId: string
): Promise<AuthUserRow | null> {
  const result = await executor.query<AuthUserRow>(
    `UPDATE "users"
     SET "email_verified_at" = CURRENT_TIMESTAMP,
         "status" = 'active',
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "status" = 'pending'
     RETURNING ${userColumns}`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function updateUserPassword(
  executor: DatabaseExecutor,
  userId: string,
  passwordHash: string
): Promise<void> {
  await executor.query(
    `UPDATE "users"
     SET "password_hash" = $2, "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    [userId, passwordHash]
  );
}

export async function createSession(
  executor: DatabaseExecutor,
  input: {
    absoluteExpiresAt: Date;
    csrfTokenHash: string;
    deviceSummary: string;
    tokenHash: string;
    userId: string;
  }
): Promise<SessionRow> {
  assertTokenHash(input.tokenHash);
  assertTokenHash(input.csrfTokenHash);
  const result = await executor.query<SessionRow>(
    `INSERT INTO "sessions"
       ("user_id", "token_hash", "csrf_token_hash", "device_summary",
        "absolute_expires_at")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${sessionColumns}`,
    [
      input.userId,
      input.tokenHash,
      input.csrfTokenHash,
      input.deviceSummary.slice(0, 160),
      input.absoluteExpiresAt,
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AuthInputError("The session insert returned no row.");
  }
  return row;
}

export async function findSessionByTokenHash(
  executor: DatabaseExecutor,
  tokenHash: string
): Promise<SessionRow | null> {
  assertTokenHash(tokenHash);
  const result = await executor.query<SessionRow>(
    `SELECT ${sessionColumns} FROM "sessions" WHERE "token_hash" = $1`,
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

export async function touchSession(
  executor: DatabaseExecutor,
  sessionId: string
): Promise<void> {
  await executor.query(
    `UPDATE "sessions" SET "last_seen_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    [sessionId]
  );
}

export async function revokeSessionById(
  executor: DatabaseExecutor,
  input: { sessionId: string; userId: string }
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE "sessions"
     SET "revoked_at" = CURRENT_TIMESTAMP
     WHERE "id" = $1 AND "user_id" = $2 AND "revoked_at" IS NULL`,
    [input.sessionId, input.userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeUserSessions(
  executor: DatabaseExecutor,
  input: { exceptSessionId?: string; userId: string }
): Promise<number> {
  const result = input.exceptSessionId
    ? await executor.query(
        `UPDATE "sessions"
         SET "revoked_at" = CURRENT_TIMESTAMP
         WHERE "user_id" = $1 AND "revoked_at" IS NULL AND "id" <> $2`,
        [input.userId, input.exceptSessionId]
      )
    : await executor.query(
        `UPDATE "sessions"
         SET "revoked_at" = CURRENT_TIMESTAMP
         WHERE "user_id" = $1 AND "revoked_at" IS NULL`,
        [input.userId]
      );
  return result.rowCount ?? 0;
}

export async function listActiveSessions(
  executor: DatabaseExecutor,
  input: { idleCutoff: Date; userId: string }
): Promise<SessionRow[]> {
  const result = await executor.query<SessionRow>(
    `SELECT ${sessionColumns} FROM "sessions"
     WHERE "user_id" = $1
       AND "revoked_at" IS NULL
       AND "absolute_expires_at" > CURRENT_TIMESTAMP
       AND "last_seen_at" >= $2
     ORDER BY "created_at" DESC`,
    [input.userId, input.idleCutoff]
  );
  return result.rows;
}

export async function createAuthToken(
  executor: DatabaseExecutor,
  input: {
    expiresAt: Date;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    userId: string;
  }
): Promise<AuthTokenRow> {
  assertTokenHash(input.tokenHash);
  const result = await executor.query<AuthTokenRow>(
    `INSERT INTO "auth_tokens" ("user_id", "purpose", "token_hash", "expires_at")
     VALUES ($1, $2, $3, $4)
     RETURNING
       "id",
       "user_id" AS "userId",
       "purpose",
       "expires_at" AS "expiresAt",
       "consumed_at" AS "consumedAt"`,
    [input.userId, input.purpose, input.tokenHash, input.expiresAt]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AuthInputError("The auth token insert returned no row.");
  }
  return row;
}

export async function consumeAuthToken(
  executor: DatabaseExecutor,
  input: { purpose: AuthTokenPurpose; tokenHash: string }
): Promise<AuthTokenRow | null> {
  assertTokenHash(input.tokenHash);
  const result = await executor.query<AuthTokenRow>(
    `UPDATE "auth_tokens"
     SET "consumed_at" = CURRENT_TIMESTAMP
     WHERE "token_hash" = $1
       AND "purpose" = $2
       AND "consumed_at" IS NULL
       AND "expires_at" > CURRENT_TIMESTAMP
     RETURNING
       "id",
       "user_id" AS "userId",
       "purpose",
       "expires_at" AS "expiresAt",
       "consumed_at" AS "consumedAt"`,
    [input.tokenHash, input.purpose]
  );
  return result.rows[0] ?? null;
}

export async function invalidateAuthTokens(
  executor: DatabaseExecutor,
  input: { purpose: AuthTokenPurpose; userId: string }
): Promise<number> {
  const result = await executor.query(
    `UPDATE "auth_tokens"
     SET "consumed_at" = CURRENT_TIMESTAMP
     WHERE "user_id" = $1 AND "purpose" = $2 AND "consumed_at" IS NULL`,
    [input.userId, input.purpose]
  );
  return result.rowCount ?? 0;
}
