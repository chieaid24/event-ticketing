import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  hashQrToken,
  TicketNotFoundError,
  type RotateTicketOutcome,
  type TicketAccessRecord,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  AuthService,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { TicketsService } from "./tickets.service.js";
import type { TicketsStore } from "./tickets.store.js";

const context: RequestAuthContext = {
  csrfToken: "a-valid-csrf-token-value",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "a-valid-session-secret-value",
};

const ticketId = "77777777-7777-4777-8777-777777777777";
const userId = "88888888-8888-4888-8888-888888888888";

function makeSession(): AuthenticatedSession {
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
  async requireSession(): Promise<AuthenticatedSession> {
    return makeSession();
  }

  async requireMutationSession(): Promise<AuthenticatedSession> {
    return makeSession();
  }
}

function makeRecord(
  overrides: Partial<TicketAccessRecord> = {}
): TicketAccessRecord {
  return {
    eventEndsAt: new Date("2026-09-01T23:00:00Z"),
    eventId: randomUUID(),
    eventStartsAt: new Date("2026-09-01T19:00:00Z"),
    eventStatus: "published",
    eventTimezone: "America/Toronto",
    eventTitle: "Autumn Gala",
    id: ticketId,
    orderId: randomUUID(),
    orderPublicNumber: "ET-0123456789AB",
    publicNumber: "TK-ABCDEF012345",
    qrRotatedAt: null,
    rowLabel: "C",
    seatAccessible: false,
    seatLabel: "12",
    sectionName: "Orchestra",
    status: "active",
    ticketTypeKind: "assigned",
    ticketTypeName: "Reserved",
    venueDescription: "Enter via the north doors.",
    venueName: "Grand Hall",
    ...overrides,
  };
}

function makeService(store: TicketsStore): TicketsService {
  return new TicketsService(new FakeAuth() as unknown as AuthService, store);
}

function makeStore(overrides: Partial<TicketsStore> = {}): TicketsStore {
  return {
    listTickets: vi.fn(),
    loadTicket: vi.fn(),
    rotateQr: vi.fn(),
    ...overrides,
  };
}

describe("TicketsService.listTickets", () => {
  it("maps owned tickets to summaries with access details", async () => {
    const store = makeStore({
      listTickets: vi.fn().mockResolvedValue([makeRecord()]),
    });

    const result = await makeService(store).listTickets(context);

    expect(store.listTickets).toHaveBeenCalledWith({ userId });
    expect(result.tickets).toHaveLength(1);
    const ticket = result.tickets[0]!;
    expect(ticket.publicNumber).toBe("TK-ABCDEF012345");
    expect(ticket.eventTimezone).toBe("America/Toronto");
    expect(ticket.venueName).toBe("Grand Hall");
    expect(ticket.eventStartsAt).toBe("2026-09-01T19:00:00.000Z");
    // A summary never carries a token or a hash.
    expect(Object.keys(ticket)).not.toContain("qrTokenHash");
    expect(Object.keys(ticket)).not.toContain("token");
  });
});

describe("TicketsService.getTicket", () => {
  it("rejects a malformed ticket id without querying", async () => {
    const store = makeStore();

    const error = await makeService(store)
      .getTicket(context, "../../etc/passwd")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect(store.loadTicket).not.toHaveBeenCalled();
  });

  it("translates a missing or foreign ticket to a 404", async () => {
    const store = makeStore({
      loadTicket: vi.fn().mockRejectedValue(new TicketNotFoundError()),
    });

    const error = await makeService(store)
      .getTicket(context, ticketId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: "ticket_not_found",
    });
  });
});

describe("TicketsService.revealQr", () => {
  it("returns a fresh bearer and stores only its hash", async () => {
    const rotate = vi
      .fn<(input: unknown) => Promise<RotateTicketOutcome>>()
      .mockResolvedValue({
        outcome: "rotated",
        publicNumber: "TK-ABCDEF012345",
        rotatedAt: new Date("2026-08-01T00:00:00Z"),
      });
    const store = makeStore({ rotateQr: rotate });

    const result = await makeService(store).revealQr(context, ticketId);

    expect(result.token.length).toBeGreaterThan(0);
    expect(result.publicNumber).toBe("TK-ABCDEF012345");
    // The store only ever receives the hash of the raw bearer, never the bearer.
    const passed = rotate.mock.calls[0]![0] as { tokenHash: string };
    expect(passed.tokenHash).toBe(hashQrToken(result.token));
    expect(passed.tokenHash).not.toBe(result.token);
  });

  it("mints a different bearer on each reveal, invalidating the prior one", async () => {
    const rotate = vi
      .fn<(input: unknown) => Promise<RotateTicketOutcome>>()
      .mockResolvedValue({
        outcome: "rotated",
        publicNumber: "TK-ABCDEF012345",
        rotatedAt: new Date(),
      });
    const service = makeService(makeStore({ rotateQr: rotate }));

    const first = await service.revealQr(context, ticketId);
    const second = await service.revealQr(context, ticketId);

    expect(first.token).not.toBe(second.token);
    const firstHash = (rotate.mock.calls[0]![0] as { tokenHash: string })
      .tokenHash;
    const secondHash = (rotate.mock.calls[1]![0] as { tokenHash: string })
      .tokenHash;
    expect(firstHash).not.toBe(secondHash);
  });

  it("reports 409 when the ticket is not active", async () => {
    const store = makeStore({
      rotateQr: vi
        .fn()
        .mockResolvedValue({ outcome: "not_active", status: "void" }),
    });

    const error = await makeService(store)
      .revealQr(context, ticketId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: "ticket_not_active",
    });
  });

  it("translates a missing or foreign ticket to a 404", async () => {
    const store = makeStore({
      rotateQr: vi.fn().mockRejectedValue(new TicketNotFoundError()),
    });

    const error = await makeService(store)
      .revealQr(context, ticketId)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
  });
});
