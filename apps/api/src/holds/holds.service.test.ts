import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  HoldEventNotFoundError,
  SeatsUnavailableError,
  type AssignedSeatHoldRecord,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  AuthService,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { HoldsService } from "./holds.service.js";
import type { HoldsStore } from "./holds.store.js";

const context: RequestAuthContext = {
  csrfToken: "a-valid-csrf-token-value",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "a-valid-session-secret-value",
};

const eventId = "33333333-3333-4333-8333-333333333333";
const seatId = "44444444-4444-4444-8444-444444444444";
const ticketTypeId = "55555555-5555-4555-8555-555555555555";
const validBody = { eventId, seatIds: [seatId] };

function makeSession(userId: string): AuthenticatedSession {
  return {
    session: {
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      csrfTokenHash: "0".repeat(64),
      deviceSummary: "test",
      id: randomUUID(),
      lastSeenAt: new Date(),
      revokedAt: null,
      tokenHash: "0".repeat(64),
      userId,
    },
    user: {
      createdAt: new Date(),
      email: "actor@example.test",
      emailVerifiedAt: new Date(),
      id: userId,
      passwordHash: null,
      platformRole: "customer",
      status: "active",
    },
  };
}

class FakeAuth {
  constructor(private readonly authenticated: AuthenticatedSession) {}

  async requireSession(): Promise<AuthenticatedSession> {
    return this.authenticated;
  }

  async requireMutationSession(): Promise<AuthenticatedSession> {
    return this.authenticated;
  }
}

function makeHold(
  overrides: Partial<AssignedSeatHoldRecord> = {}
): AssignedSeatHoldRecord {
  return {
    createdAt: new Date(),
    currency: "USD",
    eventId,
    expiresAt: new Date(Date.now() + 600_000),
    feeMinor: 200,
    guestSessionId: null,
    id: randomUUID(),
    idempotencyKey: "idem-1",
    replayed: false,
    seats: [
      {
        eventSeatId: seatId,
        rowLabel: "A",
        seatLabel: "1",
        sectionName: "Reserved",
        ticketTypeId,
        unitFeeMinor: 200,
        unitPriceMinor: 4_000,
      },
    ],
    status: "active",
    subtotalMinor: 4_000,
    totalMinor: 4_200,
    userId: randomUUID(),
    ...overrides,
  };
}

function makeService(store: HoldsStore): HoldsService {
  return new HoldsService(
    new FakeAuth(makeSession(randomUUID())) as unknown as AuthService,
    store
  );
}

const unusedGeneralAdmission: HoldsStore["createGeneralAdmissionHold"] = () =>
  Promise.reject(new Error("not under test"));

const anyHold: HoldsStore = {
  createAssignedSeatHold: () => Promise.resolve(makeHold()),
  createGeneralAdmissionHold: unusedGeneralAdmission,
};

describe("HoldsService.createAssignedSeatHold", () => {
  it("requires an idempotency key", async () => {
    const error = await makeService(anyHold)
      .createAssignedSeatHold(context, undefined, validBody)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
  });

  it("rejects an invalid request body", async () => {
    const error = await makeService(anyHold)
      .createAssignedSeatHold(context, "key-1", {
        eventId: "nope",
        seatIds: [],
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
  });

  it("maps a hold record to the response contract", async () => {
    const hold = makeHold();
    const service = makeService({
      createAssignedSeatHold: () => Promise.resolve(hold),
      createGeneralAdmissionHold: unusedGeneralAdmission,
    });

    await expect(
      service.createAssignedSeatHold(context, "key-1", validBody)
    ).resolves.toEqual({
      currency: "USD",
      eventId,
      expiresAt: hold.expiresAt.toISOString(),
      feeMinor: 200,
      holdId: hold.id,
      seats: [
        {
          eventSeatId: seatId,
          rowLabel: "A",
          seatLabel: "1",
          sectionName: "Reserved",
          ticketTypeId,
          unitFeeMinor: 200,
          unitPriceMinor: 4_000,
        },
      ],
      status: "active",
      subtotalMinor: 4_000,
      totalMinor: 4_200,
    });
  });

  it("translates a seat conflict to a 409 disclosing only seat ids", async () => {
    const service = makeService({
      createAssignedSeatHold: () =>
        Promise.reject(new SeatsUnavailableError([seatId])),
      createGeneralAdmissionHold: unusedGeneralAdmission,
    });

    const error = await service
      .createAssignedSeatHold(context, "key-1", validBody)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    expect(http.getStatus()).toBe(409);
    expect(http.getResponse()).toEqual({
      code: "seats_unavailable",
      message: expect.any(String),
      seatIds: [seatId],
    });
  });

  it("translates a missing event to a 404", async () => {
    const service = makeService({
      createAssignedSeatHold: () =>
        Promise.reject(new HoldEventNotFoundError()),
      createGeneralAdmissionHold: unusedGeneralAdmission,
    });

    const error = await service
      .createAssignedSeatHold(context, "key-1", validBody)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
  });
});
