import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type { VenueLayout } from "@event-ticketing/contracts";
import type {
  MembershipRole,
  MembershipRow,
  OrganizationRow,
  VenueLayoutSectionData,
  VenueRow,
  VenueSummaryRow,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { VenuesService } from "./venues.service.js";
import type {
  CreateVenueResult,
  ReplaceLayoutResult,
  UpdateVenueResult,
  VenuesStore,
} from "./venues.store.js";

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

function makeVenue(overrides: Partial<VenueRow> = {}): VenueRow {
  return {
    createdAt: new Date(),
    description: null,
    id: randomUUID(),
    name: "Example Test Hall",
    organizationId: randomUUID(),
    updatedAt: new Date(),
    version: 1,
    ...overrides,
  };
}

class FakeVenuesStore implements VenuesStore {
  createResult: CreateVenueResult | null = null;
  deleteCalls: unknown[] = [];
  deleteResult = true;
  layout: VenueLayoutSectionData[] = [];
  memberships: MembershipRow[] = [];
  organizations: OrganizationRow[] = [];
  replaceCalls: {
    expectedVersion: number;
    sections: VenueLayoutSectionData[];
  }[] = [];
  replaceResult: ReplaceLayoutResult | null = null;
  summaries: VenueSummaryRow[] = [];
  updateResult: UpdateVenueResult | null = null;
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

  async listVenues(): Promise<VenueSummaryRow[]> {
    return this.summaries;
  }

  async fetchLayout(): Promise<VenueLayoutSectionData[]> {
    return this.layout;
  }

  async createVenue(input: {
    actorUserId: string;
    description: string | null;
    name: string;
    organizationId: string;
  }): Promise<CreateVenueResult> {
    return (
      this.createResult ??
      makeVenue({
        description: input.description,
        name: input.name,
        organizationId: input.organizationId,
      })
    );
  }

  async updateVenue(): Promise<UpdateVenueResult> {
    return this.updateResult ?? makeVenue();
  }

  async replaceLayout(input: {
    actorUserId: string;
    expectedVersion: number;
    organizationId: string;
    sections: VenueLayoutSectionData[];
    venueId: string;
  }): Promise<ReplaceLayoutResult> {
    this.replaceCalls.push({
      expectedVersion: input.expectedVersion,
      sections: input.sections,
    });
    return this.replaceResult ?? makeVenue({ id: input.venueId, version: 2 });
  }

  async deleteVenue(input: unknown): Promise<boolean> {
    this.deleteCalls.push(input);
    return this.deleteResult;
  }
}

interface Harness {
  organizationId: string;
  service: VenuesService;
  store: FakeVenuesStore;
  userId: string;
  venue: VenueRow;
}

function makeHarness(role: MembershipRole | null = "owner"): Harness {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const store = new FakeVenuesStore();
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
  const venue = makeVenue({ organizationId });
  store.venues.push(venue);
  const service = new VenuesService(new FakeAuth(makeSession(userId)), store);
  return { organizationId, service, store, userId, venue };
}

function validLayout(): VenueLayout {
  return {
    sections: [
      {
        kind: "assigned",
        name: "Stalls",
        rows: [
          {
            label: "A",
            seats: [
              {
                accessible: true,
                companion: false,
                label: "1",
                x: 0,
                y: 0,
              },
              {
                accessible: false,
                companion: true,
                label: "2",
                x: 1,
                y: 0,
              },
            ],
          },
        ],
      },
      { capacity: 100, kind: "general_admission", name: "Floor" },
    ],
  };
}

async function expectError(
  operation: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  try {
    await operation;
    expect.unreachable("The operation should have thrown.");
  } catch (error) {
    if (!(error instanceof HttpException)) {
      throw error;
    }
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  }
}

describe("membership scoping", () => {
  it("hides the organization from non-members", async () => {
    const { organizationId, service } = makeHarness(null);
    await expectError(
      service.listVenues(context, organizationId),
      404,
      "organization_not_found"
    );
  });

  it("hides another organization's venue", async () => {
    const { organizationId, service } = makeHarness();
    const foreign = makeVenue({ organizationId: randomUUID() });
    await expectError(
      service.getVenue(context, organizationId, foreign.id),
      404,
      "venue_not_found"
    );
  });

  it("rejects a malformed venue id like a missing one", async () => {
    const { organizationId, service } = makeHarness();
    await expectError(
      service.getVenue(context, organizationId, "not-a-uuid"),
      404,
      "venue_not_found"
    );
  });
});

describe("role enforcement", () => {
  it.each(["viewer", "scanner", "finance"] as const)(
    "blocks %s from creating venues",
    async (role) => {
      const { organizationId, service } = makeHarness(role);
      await expectError(
        service.createVenue(context, organizationId, { name: "New Hall" }),
        403,
        "forbidden"
      );
    }
  );

  it.each(["owner", "admin", "event_manager"] as const)(
    "lets %s create venues",
    async (role) => {
      const { organizationId, service } = makeHarness(role);
      const created = await service.createVenue(context, organizationId, {
        name: "New Hall",
      });
      expect(created.venue.name).toBe("New Hall");
      expect(created.layout.sections).toEqual([]);
    }
  );

  it("lets every member read venues", async () => {
    const { organizationId, service, venue } = makeHarness("scanner");
    const detail = await service.getVenue(context, organizationId, venue.id);
    expect(detail.venue.id).toBe(venue.id);
  });
});

describe("createVenue", () => {
  it("rejects a duplicate name", async () => {
    const { organizationId, service, store } = makeHarness();
    store.createResult = "name_taken";
    await expectError(
      service.createVenue(context, organizationId, { name: "New Hall" }),
      409,
      "venue_name_taken"
    );
  });

  it("rejects unknown fields", async () => {
    const { organizationId, service } = makeHarness();
    await expectError(
      service.createVenue(context, organizationId, {
        name: "New Hall",
        organizationId,
      }),
      400,
      "invalid_request"
    );
  });
});

describe("updateVenue", () => {
  it("reports a stale version", async () => {
    const { organizationId, service, store, venue } = makeHarness();
    store.updateResult = "version_conflict";
    await expectError(
      service.updateVenue(context, organizationId, venue.id, {
        name: "Renamed Hall",
        version: 1,
      }),
      409,
      "version_conflict"
    );
  });

  it("reports a name collision", async () => {
    const { organizationId, service, store, venue } = makeHarness();
    store.updateResult = "name_taken";
    await expectError(
      service.updateVenue(context, organizationId, venue.id, {
        name: "Taken Hall",
        version: 1,
      }),
      409,
      "venue_name_taken"
    );
  });
});

describe("replaceLayout", () => {
  it("stores a valid layout and maps general admission capacity", async () => {
    const { organizationId, service, store, venue } = makeHarness();
    const response = await service.replaceLayout(
      context,
      organizationId,
      venue.id,
      { layout: validLayout(), version: 1 }
    );
    expect(store.replaceCalls).toHaveLength(1);
    expect(store.replaceCalls[0]?.expectedVersion).toBe(1);
    expect(store.replaceCalls[0]?.sections[1]).toMatchObject({
      gaCapacity: 100,
      kind: "general_admission",
      rows: [],
    });
    expect(response.layout).toEqual(validLayout());
  });

  it("rejects a layout that breaks accessibility rules", async () => {
    const { organizationId, service, store, venue } = makeHarness();
    const layout = validLayout();
    const stalls = layout.sections[0];
    if (stalls?.kind === "assigned" && stalls.rows[0]?.seats[0]) {
      stalls.rows[0].seats[0].accessible = false;
    }
    await expectError(
      service.replaceLayout(context, organizationId, venue.id, {
        layout,
        version: 1,
      }),
      400,
      "layout_invalid"
    );
    expect(store.replaceCalls).toHaveLength(0);
  });

  it("reports a stale version", async () => {
    const { organizationId, service, store, venue } = makeHarness();
    store.replaceResult = "version_conflict";
    await expectError(
      service.replaceLayout(context, organizationId, venue.id, {
        layout: validLayout(),
        version: 1,
      }),
      409,
      "version_conflict"
    );
  });
});

describe("deleteVenue", () => {
  it("deletes and reports acceptance", async () => {
    const { organizationId, service, store, venue } = makeHarness();
    const response = await service.deleteVenue(
      context,
      organizationId,
      venue.id
    );
    expect(response).toEqual({ status: "accepted" });
    expect(store.deleteCalls).toHaveLength(1);
  });

  it("blocks viewers", async () => {
    const { organizationId, service, venue } = makeHarness("viewer");
    await expectError(
      service.deleteVenue(context, organizationId, venue.id),
      403,
      "forbidden"
    );
  });
});
