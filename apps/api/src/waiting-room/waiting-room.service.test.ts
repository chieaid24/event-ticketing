import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import pino from "pino";
import { describe, expect, it } from "vitest";

import type {
  AuthenticatedSession,
  AuthService,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { WaitingRoomService } from "./waiting-room.service.js";
import type { WaitingRoomStore } from "./waiting-room.store.js";
import { WaitingRoomTokens } from "./waiting-room-tokens.js";

const eventId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const context: RequestAuthContext = {
  csrfToken: "valid-csrf-token-value",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "valid-session-secret-value",
};

function session(id = sessionId): AuthenticatedSession {
  return {
    session: {
      absoluteExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      csrfTokenHash: "0".repeat(64),
      deviceSummary: "test",
      id,
      lastSeenAt: new Date(),
      revokedAt: null,
      tokenHash: "0".repeat(64),
      userId: randomUUID(),
    },
    user: {
      createdAt: new Date(),
      email: "actor@example.test",
      emailVerifiedAt: new Date(),
      id: randomUUID(),
      passwordHash: null,
      platformRole: "customer",
      status: "active",
    },
  };
}

class FakeAuth {
  constructor(private readonly value: AuthenticatedSession) {}

  requireMutationSession(): Promise<AuthenticatedSession> {
    return Promise.resolve(this.value);
  }
}

function store(overrides: Partial<WaitingRoomStore> = {}): WaitingRoomStore {
  return {
    consumeAdmission: () => Promise.resolve(true),
    eventRequiresAdmission: () => Promise.resolve(true),
    heartbeat: () => Promise.resolve(true),
    join: (input) =>
      Promise.resolve({
        joinedAt: input.joinedAt,
        position: 1,
        queueDepth: 1,
      }),
    statusAndAdmit: () =>
      Promise.resolve({
        admissionRatePerMinute: 1,
        joinedAt: Date.now() - 25,
        kind: "admitted",
        queueDepth: 0,
      }),
    ...overrides,
  };
}

function service(
  waitingStore: WaitingRoomStore,
  authenticated = session()
): WaitingRoomService {
  return new WaitingRoomService(
    new FakeAuth(authenticated) as unknown as AuthService,
    waitingStore,
    new WaitingRoomTokens("a-test-secret-with-at-least-32-bytes"),
    {
      admissionCapacity: 1,
      heartbeatTtlSeconds: 60,
      leaseTtlSeconds: 300,
      tokenTtlSeconds: 1_800,
    },
    pino({ level: "silent" })
  );
}

describe("WaitingRoomService", () => {
  it("joins once and reports queue measurements", async () => {
    await expect(
      service(store()).join(context, eventId)
    ).resolves.toMatchObject({
      eventId,
      position: 1,
      queueDepth: 1,
      status: "queued",
    });
  });

  it("admits the head with wait, depth, rate, and an expiring token", async () => {
    const waiting = service(store());
    const joined = await waiting.join(context, eventId);
    await expect(
      waiting.status(context, eventId, joined.queueToken)
    ).resolves.toMatchObject({
      admissionRatePerMinute: 1,
      eventId,
      queueDepth: 0,
      status: "admitted",
    });
  });

  it("rejects a queue token presented by another session", async () => {
    const joined = await service(store()).join(context, eventId);
    const error = await service(store(), session(randomUUID()))
      .status(context, eventId, joined.queueToken)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
  });

  it("requires a consumable admission for enabled events", async () => {
    const consumeAdmission = () => Promise.resolve(false);
    const error = await service(store({ consumeAdmission }))
      .requireAdmission({
        eventId,
        idempotencyKey: "hold-1",
        sessionId,
        token: "not-a-token",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
  });

  it("skips admission for events without a waiting room", async () => {
    await expect(
      service(
        store({ eventRequiresAdmission: () => Promise.resolve(false) })
      ).requireAdmission({
        eventId,
        idempotencyKey: "hold-1",
        sessionId,
        token: undefined,
      })
    ).resolves.toBeUndefined();
  });
});
