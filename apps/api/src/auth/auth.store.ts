import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  consumeAuthToken,
  createDatabasePool,
  createSession,
  createUser,
  enqueueOutboxEvent,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  invalidateAuthTokens,
  listActiveSessions,
  markUserEmailVerified,
  revokeSessionById,
  revokeUserSessions,
  touchSession,
  updateUserPassword,
  withDatabaseTransaction,
  type AuthUserRow,
  type SessionRow,
} from "@event-ticketing/database";

export const EMAIL_VERIFICATION_REQUESTED_TOPIC =
  "auth.email.verification.requested";
export const PASSWORD_RESET_REQUESTED_TOPIC = "auth.password.reset.requested";

export interface CreateSessionInput {
  absoluteExpiresAt: Date;
  csrfTokenHash: string;
  deviceSummary: string;
  tokenHash: string;
  userId: string;
}

export interface AuthStore {
  changePassword(input: {
    passwordHash: string;
    session: CreateSessionInput;
  }): Promise<SessionRow>;
  createSession(input: CreateSessionInput): Promise<SessionRow>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  findUserByEmail(email: string): Promise<AuthUserRow | null>;
  findUserById(userId: string): Promise<AuthUserRow | null>;
  listActiveSessions(input: {
    idleCutoff: Date;
    userId: string;
  }): Promise<SessionRow[]>;
  register(input: { email: string; passwordHash: string }): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: {
    passwordHash: string;
    tokenHash: string;
  }): Promise<boolean>;
  revokeSession(input: { sessionId: string; userId: string }): Promise<boolean>;
  touchSession(sessionId: string): Promise<void>;
  verifyEmail(tokenHash: string): Promise<boolean>;
}

export class PgAuthStore implements AuthStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async register(input: {
    email: string;
    passwordHash: string;
  }): Promise<void> {
    await withDatabaseTransaction(this.pool, async (tx) => {
      const created = await createUser(tx, input);
      const user = created ?? (await findUserByEmail(tx, input.email));
      // verified accounts get no mail; pending accounts get another
      if (user && user.emailVerifiedAt === null && user.status === "pending") {
        await enqueueOutboxEvent(tx, {
          aggregateId: user.id,
          aggregateType: "user",
          payload: { userId: user.id },
          topic: EMAIL_VERIFICATION_REQUESTED_TOPIC,
        });
      }
    });
  }

  async verifyEmail(tokenHash: string): Promise<boolean> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const token = await consumeAuthToken(tx, {
        purpose: "email_verification",
        tokenHash,
      });
      if (!token) {
        return false;
      }

      await markUserEmailVerified(tx, token.userId);
      await invalidateAuthTokens(tx, {
        purpose: "email_verification",
        userId: token.userId,
      });
      return true;
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    await withDatabaseTransaction(this.pool, async (tx) => {
      const user = await findUserByEmail(tx, email);
      if (user && user.status === "active") {
        await enqueueOutboxEvent(tx, {
          aggregateId: user.id,
          aggregateType: "user",
          payload: { userId: user.id },
          topic: PASSWORD_RESET_REQUESTED_TOPIC,
        });
      }
    });
  }

  async resetPassword(input: {
    passwordHash: string;
    tokenHash: string;
  }): Promise<boolean> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const token = await consumeAuthToken(tx, {
        purpose: "password_reset",
        tokenHash: input.tokenHash,
      });
      if (!token) {
        return false;
      }

      await updateUserPassword(tx, token.userId, input.passwordHash);
      await revokeUserSessions(tx, { userId: token.userId });
      await invalidateAuthTokens(tx, {
        purpose: "password_reset",
        userId: token.userId,
      });
      return true;
    });
  }

  async changePassword(input: {
    passwordHash: string;
    session: CreateSessionInput;
  }): Promise<SessionRow> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      await updateUserPassword(tx, input.session.userId, input.passwordHash);
      await revokeUserSessions(tx, { userId: input.session.userId });
      return createSession(tx, input.session);
    });
  }

  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    return createSession(this.pool, input);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    return findSessionByTokenHash(this.pool, tokenHash);
  }

  async findUserByEmail(email: string): Promise<AuthUserRow | null> {
    return findUserByEmail(this.pool, email);
  }

  async findUserById(userId: string): Promise<AuthUserRow | null> {
    return findUserById(this.pool, userId);
  }

  async listActiveSessions(input: {
    idleCutoff: Date;
    userId: string;
  }): Promise<SessionRow[]> {
    return listActiveSessions(this.pool, input);
  }

  async revokeSession(input: {
    sessionId: string;
    userId: string;
  }): Promise<boolean> {
    return revokeSessionById(this.pool, input);
  }

  async touchSession(sessionId: string): Promise<void> {
    await touchSession(this.pool, sessionId);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
