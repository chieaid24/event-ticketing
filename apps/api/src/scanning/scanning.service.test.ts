import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type {
  CheckInInput,
  CheckInOutcome,
  EventRow,
  MembershipRole,
  MembershipRow,
  OrganizationRow,
  ReverseCheckInInput,
  ReverseCheckInOutcome,
  ScanActivityRecord,
  ScanTicketDetail,
} from "@event-ticketing/database";
import { hashQrToken } from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  RequestAuthContext,
} from "../auth/auth.service.js";
import type { RateLimiter } from "../auth/rate-limiter.js";
import { ScanningService } from "./scanning.service.js";
import type { ScanningStore } from "./scanning.store.js";

const context: RequestAuthContext = {
  csrfToken: "a-valid-csrf-token-value",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "a-valid-session-secret-value",
};

const organizationId = "22222222-2222-4222-8222-222222222222";
const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const userId = "11111111-1111-4111-8111-111111111111";
const ticketId = "77777777-7777-4777-8777-777777777777";
const deviceId = "88888888-8888-4888-8888-888888888888";

function makeSession(id: string): AuthenticatedSession {
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
      userId: id,
    },
    user: {
      createdAt: new Date(),
      email: "scanner@example.test",
      emailVerifiedAt: new Date(),
      id,
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

function makeTicketDetail(): ScanTicketDetail {
  return {
    checkedInAt: new Date("2026-07-30T18:00:00.000Z"),
    eventTitle: "Example Test Gala",
    publicNumber: "TK-0123456789AB",
    rowLabel: "A",
    seatLabel: "1",
    sectionName: "Stalls",
    ticketId,
    ticketTypeName: "Stalls Reserved",
  };
}

class FakeScanningStore implements ScanningStore {
  checkInCalls: CheckInInput[] = [];
  checkInOutcome: CheckInOutcome = {
    result: "accepted",
    scanId: randomUUID(),
    ticket: makeTicketDetail(),
  };
  events: EventRow[] = [];
  memberships: MembershipRow[] = [];
  organizations: OrganizationRow[] = [];
  reverseCalls: ReverseCheckInInput[] = [];
  reverseOutcome: ReverseCheckInOutcome = {
    outcome: "reversed",
    scanId: randomUUID(),
    ticket: { ...makeTicketDetail(), checkedInAt: null },
  };
  scans: ScanActivityRecord[] = [];

  async checkIn(input: CheckInInput): Promise<CheckInOutcome> {
    this.checkInCalls.push(input);
    return this.checkInOutcome;
  }

  async findEvent(input: {
    eventId: string;
    organizationId: string;
  }): Promise<EventRow | null> {
    return (
      this.events.find(
        (row) =>
          row.id === input.eventId &&
          row.organizationId === input.organizationId
      ) ?? null
    );
  }

  async findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null> {
    return (
      this.memberships.find(
        (row) =>
          row.organizationId === input.organizationId &&
          row.userId === input.userId
      ) ?? null
    );
  }

  async findOrganization(id: string): Promise<OrganizationRow | null> {
    return this.organizations.find((row) => row.id === id) ?? null;
  }

  async recentScans(): Promise<ScanActivityRecord[]> {
    return this.scans;
  }

  async reverse(input: ReverseCheckInInput): Promise<ReverseCheckInOutcome> {
    this.reverseCalls.push(input);
    return this.reverseOutcome;
  }
}

const allowLimiter: RateLimiter = {
  consume: vi.fn().mockResolvedValue(true),
};

function makeService(role: MembershipRole = "scanner"): {
  service: ScanningService;
  store: FakeScanningStore;
} {
  const store = new FakeScanningStore();
  store.organizations.push({
    createdAt: new Date(),
    id: organizationId,
    name: "Example Test Box Office",
    slug: "example-test-box-office",
    updatedAt: new Date(),
    version: 1,
  });
  store.memberships.push({
    createdAt: new Date(),
    id: randomUUID(),
    invitedById: null,
    joinedAt: new Date(),
    organizationId,
    role,
    status: "active",
    userId,
  });
  store.events.push({ id: eventId, organizationId } as EventRow);
  const service = new ScanningService(
    new FakeAuth(makeSession(userId)),
    store,
    allowLimiter
  );
  return { service, store };
}

async function statusOf(operation: Promise<unknown>): Promise<number> {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

describe("ScanningService.checkIn", () => {
  it("hashes the raw QR bearer before it reaches the store", async () => {
    const { service, store } = makeService();
    const rawToken = "raw-bearer-value-that-must-never-persist";

    await service.checkIn(context, organizationId, eventId, {
      deviceId,
      qrToken: rawToken,
    });

    const call = store.checkInCalls[0];
    expect(call?.credential).toEqual({
      kind: "qr",
      tokenHash: hashQrToken(rawToken),
    });
    expect(JSON.stringify(call)).not.toContain(rawToken);
  });

  it("uppercases a manually typed public number", async () => {
    const { service, store } = makeService();

    await service.checkIn(context, organizationId, eventId, {
      deviceId,
      publicNumber: "tk-0123456789ab",
    });

    expect(store.checkInCalls[0]?.credential).toEqual({
      kind: "public_number",
      publicNumber: "TK-0123456789AB",
    });
  });

  it("returns the store outcome with ISO timestamps", async () => {
    const { service } = makeService();

    const response = await service.checkIn(context, organizationId, eventId, {
      deviceId,
      qrToken: "raw-bearer-value-that-must-never-persist",
    });

    expect(response.result).toBe("accepted");
    expect(response.ticket?.checkedInAt).toBe("2026-07-30T18:00:00.000Z");
  });

  it("rejects a member without scanner.checkin", async () => {
    const { service } = makeService("viewer");

    const status = await statusOf(
      service.checkIn(context, organizationId, eventId, {
        deviceId,
        qrToken: "raw-bearer-value-that-must-never-persist",
      })
    );
    expect(status).toBe(403);
  });

  it("answers 404 for a non-member as for a missing organization", async () => {
    const { service, store } = makeService();
    store.memberships = [];

    const status = await statusOf(
      service.checkIn(context, organizationId, eventId, {
        deviceId,
        qrToken: "raw-bearer-value-that-must-never-persist",
      })
    );
    expect(status).toBe(404);
  });

  it("answers 404 for an event outside the organization", async () => {
    const { service, store } = makeService();
    store.events = [];

    const status = await statusOf(
      service.checkIn(context, organizationId, eventId, {
        deviceId,
        qrToken: "raw-bearer-value-that-must-never-persist",
      })
    );
    expect(status).toBe(404);
  });

  it("rejects a request carrying both credentials", async () => {
    const { service } = makeService();

    const status = await statusOf(
      service.checkIn(context, organizationId, eventId, {
        deviceId,
        publicNumber: "TK-0123456789AB",
        qrToken: "raw-bearer-value-that-must-never-persist",
      })
    );
    expect(status).toBe(400);
  });

  it("answers 429 when a scan limit is exhausted", async () => {
    const { store } = makeService();
    const denyLimiter: RateLimiter = {
      consume: vi.fn().mockResolvedValue(false),
    };
    const service = new ScanningService(
      new FakeAuth(makeSession(userId)),
      store,
      denyLimiter
    );

    const status = await statusOf(
      service.checkIn(context, organizationId, eventId, {
        deviceId,
        qrToken: "raw-bearer-value-that-must-never-persist",
      })
    );
    expect(status).toBe(429);
    expect(store.checkInCalls).toHaveLength(0);
  });
});

describe("ScanningService.reverse", () => {
  it("requires the supervisor-only scanner.reverse permission", async () => {
    const { service, store } = makeService("scanner");

    const status = await statusOf(
      service.reverse(context, organizationId, eventId, {
        deviceId,
        reason: "Scanned the wrong attendee by accident.",
        ticketId,
      })
    );
    expect(status).toBe(403);
    expect(store.reverseCalls).toHaveLength(0);
  });

  it("passes the reason through for an admin", async () => {
    const { service, store } = makeService("admin");

    const response = await service.reverse(context, organizationId, eventId, {
      deviceId,
      reason: "Scanned the wrong attendee by accident.",
      ticketId,
    });

    expect(store.reverseCalls[0]?.reason).toBe(
      "Scanned the wrong attendee by accident."
    );
    expect(response.ticket.checkedInAt).toBeNull();
  });

  it("answers 409 when the ticket is not checked in", async () => {
    const { service, store } = makeService("admin");
    store.reverseOutcome = { outcome: "not_checked_in", status: "active" };

    const status = await statusOf(
      service.reverse(context, organizationId, eventId, {
        deviceId,
        reason: "Scanned the wrong attendee by accident.",
        ticketId,
      })
    );
    expect(status).toBe(409);
  });

  it("answers 404 for a ticket outside the event", async () => {
    const { service, store } = makeService("admin");
    store.reverseOutcome = { outcome: "not_found" };

    const status = await statusOf(
      service.reverse(context, organizationId, eventId, {
        deviceId,
        reason: "Scanned the wrong attendee by accident.",
        ticketId,
      })
    );
    expect(status).toBe(404);
  });
});

describe("ScanningService.activity", () => {
  it("mirrors the caller's reversal permission", async () => {
    const scanner = await makeService("scanner").service.activity(
      context,
      organizationId,
      eventId
    );
    expect(scanner.canReverse).toBe(false);

    const admin = await makeService("admin").service.activity(
      context,
      organizationId,
      eventId
    );
    expect(admin.canReverse).toBe(true);
  });

  it("rejects a viewer without scanner.checkin", async () => {
    const status = await statusOf(
      makeService("viewer").service.activity(context, organizationId, eventId)
    );
    expect(status).toBe(403);
  });
});
