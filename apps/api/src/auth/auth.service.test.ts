import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  hashAuthSecret,
  type AuthUserRow,
  type SessionRow,
} from "@event-ticketing/database";

import { hashPassword } from "./passwords.js";
import { AuthService, type RequestAuthContext } from "./auth.service.js";
import type { AuthStore, CreateSessionInput } from "./auth.store.js";

const TRUSTED_ORIGIN = "http://127.0.0.1:3000";

function makeUser(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    createdAt: new Date(),
    email: "customer@example.test",
    emailVerifiedAt: new Date(),
    id: randomUUID(),
    passwordHash: null,
    platformRole: "customer",
    status: "active",
    ...overrides,
  };
}

class FakeAuthStore implements AuthStore {
  changePasswordCalls: { passwordHash: string; session: CreateSessionInput }[] =
    [];
  createdSessions: SessionRow[] = [];
  registerCalls: { email: string; passwordHash: string }[] = [];
  resetPasswordCalls: { passwordHash: string; tokenHash: string }[] = [];
  resetPasswordResult = false;
  resetRequests: string[] = [];
  revokeCalls: { sessionId: string; userId: string }[] = [];
  revokeResult = true;
  sessionRows: SessionRow[] = [];
  touchedSessionIds: string[] = [];
  users: AuthUserRow[] = [];
  verifiedTokenHashes: string[] = [];
  verifyEmailResult = false;

  async register(input: {
    email: string;
    passwordHash: string;
  }): Promise<void> {
    this.registerCalls.push(input);
  }

  async verifyEmail(tokenHash: string): Promise<boolean> {
    this.verifiedTokenHashes.push(tokenHash);
    return this.verifyEmailResult;
  }

  async requestPasswordReset(email: string): Promise<void> {
    this.resetRequests.push(email);
  }

  async resetPassword(input: {
    passwordHash: string;
    tokenHash: string;
  }): Promise<boolean> {
    this.resetPasswordCalls.push(input);
    return this.resetPasswordResult;
  }

  async changePassword(input: {
    passwordHash: string;
    session: CreateSessionInput;
  }): Promise<SessionRow> {
    this.changePasswordCalls.push(input);
    for (const row of this.sessionRows) {
      row.revokedAt = new Date();
    }
    return this.createSession(input.session);
  }

  private readonly sessionsByTokenHash = new Map<string, SessionRow>();

  async createSession(input: CreateSessionInput): Promise<SessionRow> {
    const row: SessionRow = {
      absoluteExpiresAt: input.absoluteExpiresAt,
      createdAt: new Date(),
      csrfTokenHash: input.csrfTokenHash,
      deviceSummary: input.deviceSummary,
      id: randomUUID(),
      lastSeenAt: new Date(),
      revokedAt: null,
      userId: input.userId,
    };
    this.sessionRows.push(row);
    this.createdSessions.push(row);
    this.sessionsByTokenHash.set(input.tokenHash, row);
    return row;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    return this.sessionsByTokenHash.get(tokenHash) ?? null;
  }

  async findUserByEmail(email: string): Promise<AuthUserRow | null> {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async findUserById(userId: string): Promise<AuthUserRow | null> {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async listActiveSessions(input: {
    idleCutoff: Date;
    userId: string;
  }): Promise<SessionRow[]> {
    return this.sessionRows.filter(
      (row) =>
        row.userId === input.userId &&
        row.revokedAt === null &&
        row.lastSeenAt >= input.idleCutoff
    );
  }

  async revokeSession(input: {
    sessionId: string;
    userId: string;
  }): Promise<boolean> {
    this.revokeCalls.push(input);
    return this.revokeResult;
  }

  async touchSession(sessionId: string): Promise<void> {
    this.touchedSessionIds.push(sessionId);
  }
}

function makeService(store: FakeAuthStore): AuthService {
  return new AuthService(store, {
    sessionAbsoluteTtlSeconds: 3_600,
    sessionIdleTtlSeconds: 600,
    trustedOrigins: [TRUSTED_ORIGIN],
  });
}

function contextFor(
  sessionSecret: string | undefined,
  overrides: Partial<RequestAuthContext> = {}
): RequestAuthContext {
  return {
    csrfToken: undefined,
    origin: undefined,
    sessionSecret,
    ...overrides,
  };
}

async function expectHttpError(
  work: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  try {
    await work;
    expect.fail(`Expected an HTTP ${String(status)} ${code} error.`);
  } catch (error) {
    if (!(error instanceof HttpException)) {
      throw error;
    }
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  }
}

describe("AuthService register", () => {
  it("stores an argon2id hash, never the raw password", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);

    const result = await service.register({
      email: "New.Customer@Example.TEST",
      password: "a-long-enough-password",
    });

    expect(result).toEqual({ status: "accepted" });
    expect(store.registerCalls).toHaveLength(1);
    const call = store.registerCalls[0];
    expect(call?.email).toBe("new.customer@example.test");
    expect(call?.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(call?.passwordHash).not.toContain("a-long-enough-password");
  });

  it("rejects a short password before touching the store", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);

    await expectHttpError(
      service.register({ email: "a@example.test", password: "short" }),
      400,
      "invalid_request"
    );
    expect(store.registerCalls).toHaveLength(0);
  });
});

describe("AuthService login", () => {
  it("returns identical errors for unknown emails and wrong passwords", async () => {
    const store = new FakeAuthStore();
    store.users.push(
      makeUser({
        email: "known@example.test",
        passwordHash: await hashPassword("the-correct-password"),
      })
    );
    const service = makeService(store);

    const errorOf = async (email: string): Promise<unknown> => {
      try {
        await service.login({ email, password: "a-wrong-password" }, "test");
        return null;
      } catch (error) {
        return error instanceof HttpException ? error.getResponse() : error;
      }
    };

    const unknownEmail = await errorOf("unknown@example.test");
    const wrongPassword = await errorOf("known@example.test");
    expect(unknownEmail).toEqual(wrongPassword);
    expect(unknownEmail).toMatchObject({ code: "invalid_credentials" });
  });

  it("creates a session with hashed secrets on success", async () => {
    const store = new FakeAuthStore();
    const user = makeUser({
      passwordHash: await hashPassword("the-correct-password"),
    });
    store.users.push(user);
    const service = makeService(store);

    const { secrets, user: publicUser } = await service.login(
      { email: user.email, password: "the-correct-password" },
      "Test Browser"
    );

    expect(publicUser.id).toBe(user.id);
    const session = store.createdSessions[0];
    expect(session?.userId).toBe(user.id);
    // only sha-256 hashes of secrets reach store
    expect(store.createdSessions[0]?.csrfTokenHash).toBe(
      hashAuthSecret(secrets.csrfSecret)
    );
    expect(session?.deviceSummary).toBe("Test Browser");
  });

  it("blocks unverified accounts even with the right password", async () => {
    const store = new FakeAuthStore();
    const user = makeUser({
      emailVerifiedAt: null,
      passwordHash: await hashPassword("the-correct-password"),
      status: "pending",
    });
    store.users.push(user);
    const service = makeService(store);

    await expectHttpError(
      service.login(
        { email: user.email, password: "the-correct-password" },
        "test"
      ),
      403,
      "email_not_verified"
    );
  });

  it("blocks suspended accounts", async () => {
    const store = new FakeAuthStore();
    const user = makeUser({
      passwordHash: await hashPassword("the-correct-password"),
      status: "suspended",
    });
    store.users.push(user);
    const service = makeService(store);

    await expectHttpError(
      service.login(
        { email: user.email, password: "the-correct-password" },
        "test"
      ),
      403,
      "account_unavailable"
    );
  });
});

describe("AuthService sessions", () => {
  async function loggedInContext(
    store: FakeAuthStore,
    service: AuthService,
    password = "the-correct-password"
  ): Promise<{ context: RequestAuthContext; user: AuthUserRow }> {
    const user = makeUser({ passwordHash: await hashPassword(password) });
    store.users.push(user);
    const { secrets } = await service.login(
      { email: user.email, password },
      "test"
    );
    return {
      context: contextFor(secrets.sessionSecret, {
        csrfToken: secrets.csrfSecret,
        origin: TRUSTED_ORIGIN,
      }),
      user,
    };
  }

  it("resolves the current user and touches the session", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const { context, user } = await loggedInContext(store, service);

    const me = await service.me(context);

    expect(me.user.email).toBe(user.email);
    expect(store.touchedSessionIds).toHaveLength(1);
  });

  it("rejects a revoked session", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const { context } = await loggedInContext(store, service);
    const session = store.createdSessions[0];
    if (session) {
      session.revokedAt = new Date();
    }

    await expectHttpError(service.me(context), 401, "unauthenticated");
  });

  it("rejects a session past its absolute expiry", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const { context } = await loggedInContext(store, service);
    const session = store.createdSessions[0];
    if (session) {
      session.absoluteExpiresAt = new Date(Date.now() - 1_000);
    }

    await expectHttpError(service.me(context), 401, "unauthenticated");
  });

  it("rejects a session that idled out", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const { context } = await loggedInContext(store, service);
    const session = store.createdSessions[0];
    if (session) {
      session.lastSeenAt = new Date(Date.now() - 601 * 1000);
    }

    await expectHttpError(service.me(context), 401, "unauthenticated");
  });

  it("rejects a syntactically invalid session cookie without a lookup", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);

    await expectHttpError(
      service.me(contextFor("not!a!valid!secret")),
      401,
      "unauthenticated"
    );
  });

  it("lists sessions and flags the current one", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const { context, user } = await loggedInContext(store, service);
    await store.createSession({
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      csrfTokenHash: hashAuthSecret("other-csrf-secret-value"),
      deviceSummary: "Other Device",
      tokenHash: hashAuthSecret("other-session-secret-value"),
      userId: user.id,
    });

    const result = await service.listSessions(context);

    expect(result.sessions).toHaveLength(2);
    const current = result.sessions.filter((session) => session.current);
    expect(current).toHaveLength(1);
    expect(current[0]?.deviceSummary).toBe("test");
  });

  it("revokes a target session after a CSRF check", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const { context } = await loggedInContext(store, service);
    const target = randomUUID();

    const result = await service.revokeSession(context, target);

    expect(result.response).toEqual({ status: "accepted" });
    expect(result.currentRevoked).toBe(false);
    expect(store.revokeCalls[0]?.sessionId).toBe(target);
  });

  it("returns 404 when the session belongs to nobody", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const { context } = await loggedInContext(store, service);
    store.revokeResult = false;

    await expectHttpError(
      service.revokeSession(context, randomUUID()),
      404,
      "session_not_found"
    );
  });
});

describe("AuthService CSRF protection", () => {
  it("rejects mutations with a wrong CSRF token", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const user = makeUser({
      passwordHash: await hashPassword("the-correct-password"),
    });
    store.users.push(user);
    const { secrets } = await service.login(
      { email: user.email, password: "the-correct-password" },
      "test"
    );

    await expectHttpError(
      service.logout(
        contextFor(secrets.sessionSecret, {
          csrfToken: "a-wrong-csrf-token-value",
          origin: TRUSTED_ORIGIN,
        })
      ),
      403,
      "invalid_csrf_token"
    );
    expect(store.revokeCalls).toHaveLength(0);
  });

  it("rejects mutations from an untrusted origin", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const user = makeUser({
      passwordHash: await hashPassword("the-correct-password"),
    });
    store.users.push(user);
    const { secrets } = await service.login(
      { email: user.email, password: "the-correct-password" },
      "test"
    );

    await expectHttpError(
      service.logout(
        contextFor(secrets.sessionSecret, {
          csrfToken: secrets.csrfSecret,
          origin: "https://evil.example.com",
        })
      ),
      403,
      "untrusted_origin"
    );
  });
});

describe("AuthService password lifecycle", () => {
  it("treats an invalid reset token as a 400", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);

    await expectHttpError(
      service.resetPassword({
        password: "a-brand-new-password",
        token: "some-plausible-token-value",
      }),
      400,
      "invalid_token"
    );
  });

  it("rotates the session when the password changes", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const user = makeUser({
      passwordHash: await hashPassword("the-correct-password"),
    });
    store.users.push(user);
    const { secrets } = await service.login(
      { email: user.email, password: "the-correct-password" },
      "test"
    );
    const originalSession = store.createdSessions.at(-1);

    const { secrets: rotated } = await service.changePassword(
      contextFor(secrets.sessionSecret, {
        csrfToken: secrets.csrfSecret,
        origin: TRUSTED_ORIGIN,
      }),
      {
        currentPassword: "the-correct-password",
        newPassword: "an-even-longer-password",
      },
      "test"
    );

    expect(rotated.sessionSecret).not.toBe(secrets.sessionSecret);
    expect(store.changePasswordCalls).toHaveLength(1);
    expect(originalSession?.revokedAt).not.toBeNull();
    const newHash = store.changePasswordCalls[0]?.passwordHash ?? "";
    expect(newHash.startsWith("$argon2id$")).toBe(true);
  });

  it("rejects a wrong current password", async () => {
    const store = new FakeAuthStore();
    const service = makeService(store);
    const user = makeUser({
      passwordHash: await hashPassword("the-correct-password"),
    });
    store.users.push(user);
    const { secrets } = await service.login(
      { email: user.email, password: "the-correct-password" },
      "test"
    );

    await expectHttpError(
      service.changePassword(
        contextFor(secrets.sessionSecret, {
          csrfToken: secrets.csrfSecret,
          origin: TRUSTED_ORIGIN,
        }),
        {
          currentPassword: "not-the-right-password",
          newPassword: "an-even-longer-password",
        },
        "test"
      ),
      403,
      "invalid_credentials"
    );
    expect(store.changePasswordCalls).toHaveLength(0);
  });
});
