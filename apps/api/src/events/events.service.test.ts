import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type {
  EventRow,
  EventSummaryRow,
  MembershipRole,
  MembershipRow,
  OrganizationRow,
  TicketTypeInputData,
  TicketTypeRow,
  VenueRow,
  VenueSectionSummaryData,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { EventsService } from "./events.service.js";
import type {
  EventsStore,
  PublishResult,
  ReplaceTicketTypesResult,
  UpdateDraftResult,
} from "./events.store.js";

const context: RequestAuthContext = {
  csrfToken: "a-valid-csrf-token-value",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "a-valid-session-secret-value",
};

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

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    createdAt: new Date(),
    currency: "USD",
    description: null,
    endsAt: new Date("2026-09-01T04:00:00.000Z"),
    holdDurationSeconds: 600,
    id: randomUUID(),
    mediaUrl: null,
    organizationId: randomUUID(),
    publishedAt: null,
    refundPolicy: null,
    salesEndAt: new Date("2026-08-31T23:00:00.000Z"),
    salesStartAt: new Date("2026-08-01T00:00:00.000Z"),
    startsAt: new Date("2026-09-01T01:00:00.000Z"),
    status: "draft",
    timezone: "America/Toronto",
    title: "Autumn Gala",
    updatedAt: new Date(),
    venueId: randomUUID(),
    version: 1,
    waitingRoomEnabled: false,
    ...overrides,
  };
}

function makeTicketType(overrides: Partial<TicketTypeRow> = {}): TicketTypeRow {
  return {
    capacity: null,
    feeMinor: 250,
    id: randomUUID(),
    kind: "assigned",
    name: "Reserved",
    position: 0,
    priceMinor: 5_000,
    sectionName: "Stalls",
    ...overrides,
  };
}

function publishableSections(): VenueSectionSummaryData[] {
  return [
    { capacity: 0, kind: "assigned", name: "Stalls", seatCount: 10 },
    { capacity: 200, kind: "general_admission", name: "Lawn", seatCount: 0 },
  ];
}

function publishableTicketTypes(): TicketTypeRow[] {
  return [
    makeTicketType({ name: "Reserved", sectionName: "Stalls" }),
    makeTicketType({
      capacity: 100,
      kind: "general_admission",
      name: "Lawn",
      position: 1,
      priceMinor: 3_000,
      sectionName: "Lawn",
    }),
  ];
}

class FakeEventsStore implements EventsStore {
  events: EventRow[] = [];
  memberships: MembershipRow[] = [];
  organizations: OrganizationRow[] = [];
  publishResult: PublishResult | null = null;
  replaceCalls: {
    expectedVersion: number;
    ticketTypes: TicketTypeInputData[];
  }[] = [];
  replaceResult: ReplaceTicketTypesResult | null = null;
  sections: VenueSectionSummaryData[] = publishableSections();
  summaries: EventSummaryRow[] = [];
  ticketTypes: TicketTypeRow[] = publishableTicketTypes();
  updateResult: UpdateDraftResult | null = null;
  venues: VenueRow[] = [];

  async findOrganization(
    organizationId: string
  ): Promise<OrganizationRow | null> {
    return this.organizations.find((row) => row.id === organizationId) ?? null;
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

  async findVenue(input: {
    organizationId: string;
    venueId: string;
  }): Promise<VenueRow | null> {
    return (
      this.venues.find(
        (row) =>
          row.id === input.venueId &&
          row.organizationId === input.organizationId
      ) ?? null
    );
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

  async listEvents(): Promise<EventSummaryRow[]> {
    return this.summaries;
  }

  async fetchTicketTypes(): Promise<TicketTypeRow[]> {
    return this.ticketTypes;
  }

  async fetchSectionSummaries(): Promise<VenueSectionSummaryData[]> {
    return this.sections;
  }

  async createEvent(input: {
    actorUserId: string;
    organizationId: string;
    title: string;
    venueId: string;
  }): Promise<EventRow> {
    const event = makeEvent({
      organizationId: input.organizationId,
      title: input.title,
      venueId: input.venueId,
    });
    this.events.push(event);
    return event;
  }

  async updateDraft(): Promise<UpdateDraftResult> {
    return this.updateResult ?? makeEvent({ version: 2 });
  }

  async replaceTicketTypes(input: {
    expectedVersion: number;
    ticketTypes: TicketTypeInputData[];
  }): Promise<ReplaceTicketTypesResult> {
    this.replaceCalls.push({
      expectedVersion: input.expectedVersion,
      ticketTypes: input.ticketTypes,
    });
    return this.replaceResult ?? makeEvent({ version: 2 });
  }

  async publishEvent(): Promise<PublishResult> {
    return this.publishResult ?? makeEvent({ status: "published", version: 2 });
  }
}

interface Harness {
  event: EventRow;
  organizationId: string;
  service: EventsService;
  store: FakeEventsStore;
  userId: string;
  venue: VenueRow;
}

function makeHarness(role: MembershipRole | null = "owner"): Harness {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const store = new FakeEventsStore();
  store.organizations.push({
    createdAt: new Date(),
    id: organizationId,
    name: "Example Test Box Office",
    slug: "example-test-box-office",
    updatedAt: new Date(),
    version: 1,
  });
  if (role) {
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
  }
  const venue: VenueRow = {
    createdAt: new Date(),
    description: null,
    id: randomUUID(),
    name: "Example Test Hall",
    organizationId,
    updatedAt: new Date(),
    version: 1,
  };
  store.venues.push(venue);
  const event = makeEvent({ organizationId, venueId: venue.id });
  store.events.push(event);
  const service = new EventsService(new FakeAuth(makeSession(userId)), store);
  return { event, organizationId, service, store, userId, venue };
}

async function expectError(
  promise: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  try {
    await promise;
    expect.unreachable("expected the call to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect((exception.getResponse() as { code: string }).code).toBe(code);
  }
}

describe("membership scoping", () => {
  it("hides the organization from a non-member", async () => {
    const { service, organizationId } = makeHarness(null);
    await expectError(
      service.listEvents(context, organizationId),
      404,
      "organization_not_found"
    );
  });

  it("returns 404 for an unknown event", async () => {
    const { service, organizationId } = makeHarness("owner");
    await expectError(
      service.getEvent(context, organizationId, randomUUID()),
      404,
      "event_not_found"
    );
  });
});

describe("role enforcement", () => {
  it.each<MembershipRole>(["viewer", "scanner", "finance"])(
    "denies %s from creating an event",
    async (role) => {
      const { service, organizationId, venue } = makeHarness(role);
      await expectError(
        service.createEvent(context, organizationId, {
          title: "New Event",
          venueId: venue.id,
        }),
        403,
        "forbidden"
      );
    }
  );

  it.each<MembershipRole>(["owner", "admin", "event_manager"])(
    "allows %s to create an event",
    async (role) => {
      const { service, organizationId, venue } = makeHarness(role);
      const detail = await service.createEvent(context, organizationId, {
        title: "New Event",
        venueId: venue.id,
      });
      expect(detail.event.title).toBe("New Event");
      expect(detail.venue.id).toBe(venue.id);
    }
  );
});

describe("createEvent", () => {
  it("rejects an unknown venue", async () => {
    const { service, organizationId } = makeHarness("owner");
    await expectError(
      service.createEvent(context, organizationId, {
        title: "New Event",
        venueId: randomUUID(),
      }),
      404,
      "venue_not_found"
    );
  });
});

describe("updateDraft", () => {
  const draftBody = {
    currency: "USD",
    holdDurationSeconds: 600,
    waitingRoomEnabled: false,
    timezone: "America/Toronto",
    title: "Renamed Event",
    version: 1,
  };

  it("surfaces a version conflict", async () => {
    const { service, organizationId, event, store } = makeHarness("owner");
    store.updateResult = "version_conflict";
    await expectError(
      service.updateDraft(context, organizationId, event.id, draftBody),
      409,
      "version_conflict"
    );
  });

  it("rejects editing a published event", async () => {
    const { service, organizationId, store } = makeHarness("owner");
    const published = makeEvent({
      organizationId,
      publishedAt: new Date(),
      status: "published",
    });
    store.events.push(published);
    await expectError(
      service.updateDraft(context, organizationId, published.id, draftBody),
      409,
      "event_not_draft"
    );
  });

  it("updates a draft and returns detail", async () => {
    const { service, organizationId, event } = makeHarness("owner");
    const detail = await service.updateDraft(
      context,
      organizationId,
      event.id,
      draftBody
    );
    expect(detail.event.version).toBe(2);
  });
});

describe("replaceTicketTypes", () => {
  it("rejects a ticket type with no matching section", async () => {
    const { service, organizationId, event } = makeHarness("owner");
    await expectError(
      service.replaceTicketTypes(context, organizationId, event.id, {
        ticketTypes: [
          {
            feeMinor: 0,
            kind: "assigned",
            name: "Ghost",
            priceMinor: 1_000,
            sectionName: "Nowhere",
          },
        ],
        version: 1,
      }),
      400,
      "ticket_types_invalid"
    );
  });

  it("stores normalized ticket types and returns detail", async () => {
    const { service, organizationId, event, store } = makeHarness("owner");
    const detail = await service.replaceTicketTypes(
      context,
      organizationId,
      event.id,
      {
        ticketTypes: [
          {
            feeMinor: 250,
            kind: "assigned",
            name: "Reserved",
            priceMinor: 5_000,
            sectionName: "Stalls",
          },
        ],
        version: 1,
      }
    );
    expect(detail.event.version).toBe(2);
    expect(store.replaceCalls).toHaveLength(1);
    expect(store.replaceCalls[0]?.ticketTypes[0]?.capacity).toBeNull();
  });

  it("surfaces a version conflict", async () => {
    const { service, organizationId, event, store } = makeHarness("owner");
    store.replaceResult = "version_conflict";
    await expectError(
      service.replaceTicketTypes(context, organizationId, event.id, {
        ticketTypes: [],
        version: 1,
      }),
      409,
      "version_conflict"
    );
  });
});

describe("publishEvent", () => {
  it("rejects an incomplete event", async () => {
    const { service, organizationId, store } = makeHarness("owner");
    const incomplete = makeEvent({
      endsAt: null,
      organizationId,
      startsAt: null,
      venueId: store.venues[0]!.id,
    });
    store.events.push(incomplete);
    await expectError(
      service.publishEvent(context, organizationId, incomplete.id, {
        version: incomplete.version,
      }),
      422,
      "event_incomplete"
    );
  });

  it("rejects publishing without any ticket type", async () => {
    const { service, organizationId, event, store } = makeHarness("owner");
    store.ticketTypes = [];
    await expectError(
      service.publishEvent(context, organizationId, event.id, {
        version: event.version,
      }),
      422,
      "event_incomplete"
    );
  });

  it("surfaces a version conflict", async () => {
    const { service, organizationId, event, store } = makeHarness("owner");
    store.publishResult = "version_conflict";
    await expectError(
      service.publishEvent(context, organizationId, event.id, {
        version: event.version,
      }),
      409,
      "version_conflict"
    );
  });

  it("publishes a complete event", async () => {
    const { service, organizationId, event } = makeHarness("owner");
    const detail = await service.publishEvent(
      context,
      organizationId,
      event.id,
      { version: event.version }
    );
    expect(detail.event.status).toBe("published");
    expect(detail.publishIssues).toEqual([]);
  });
});
