import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type {
  MembershipRole,
  MembershipRow,
  OperationsJobRow,
  OrganizationAnalyticsRows,
  OrganizationRow,
  RetryJobResult,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { OperationsService } from "./operations.service.js";
import type { OperationsStore } from "./operations.store.js";

const context: RequestAuthContext = {
  csrfToken: "csrf",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "session",
};

function session(
  platformRole: "customer" | "admin" = "customer"
): AuthenticatedSession {
  const userId = randomUUID();
  return {
    session: {
      absoluteExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      csrfTokenHash: "0".repeat(64),
      deviceSummary: "test",
      id: randomUUID(),
      lastSeenAt: new Date("2026-07-30T00:00:00.000Z"),
      revokedAt: null,
      tokenHash: "0".repeat(64),
      userId,
    },
    user: {
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      email: "operator@example.test",
      emailVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
      id: userId,
      passwordHash: null,
      platformRole,
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

function organization(id: string): OrganizationRow {
  return {
    createdAt: new Date(),
    id,
    name: "Test Organization",
    slug: "test-organization",
    updatedAt: new Date(),
    version: 1,
  };
}

function membership(
  authenticated: AuthenticatedSession,
  organizationId: string,
  role: MembershipRole
): MembershipRow {
  return {
    createdAt: new Date(),
    id: randomUUID(),
    invitedById: null,
    joinedAt: new Date(),
    organizationId,
    role,
    status: "active",
    userId: authenticated.user.id,
  };
}

class FakeOperationsStore implements OperationsStore {
  analytics: OrganizationAnalyticsRows = {
    activity: [
      {
        acceptedCheckins: "3",
        checkoutStarted: "5",
        date: "2026-07-30",
        duplicateScans: "1",
        holdsCreated: "10",
        reversedCheckins: "1",
      },
    ],
    dailyFinancials: [
      {
        currency: "USD",
        date: "2026-07-30",
        feeMinor: "200",
        grossMinor: "5000",
        paidOrders: "2",
        refundCount: "1",
        refundMinor: "1000",
        ticketsSold: "4",
      },
    ],
    financials: [
      {
        currency: "USD",
        feeMinor: "200",
        grossMinor: "5000",
        paidOrders: "2",
        refundMinor: "1000",
        ticketsSold: "4",
      },
    ],
    inventory: {
      available: "20",
      blocked: "1",
      capacity: "30",
      held: "2",
      sold: "7",
    },
    refunds: {
      failed: "1",
      requested: "2",
      succeeded: "3",
    },
  };
  jobs: OperationsJobRow[] = [];
  membership: MembershipRow | null = null;
  organization: OrganizationRow | null = null;
  retryResult: RetryJobResult = "retried";
  retryCalls: unknown[] = [];

  async findMembership(): Promise<MembershipRow | null> {
    return this.membership;
  }

  async findOrganization(): Promise<OrganizationRow | null> {
    return this.organization;
  }

  async getAnalytics(): Promise<OrganizationAnalyticsRows> {
    return this.analytics;
  }

  async listOrganizationJobs(): Promise<OperationsJobRow[]> {
    return this.jobs;
  }

  async listPlatformJobs(): Promise<OperationsJobRow[]> {
    return this.jobs;
  }

  async outboxMetrics() {
    return {
      deadLetter: 0,
      oldestReadyAgeSeconds: 0,
      pendingDelayed: 0,
      pendingReady: 0,
      processing: 0,
      retrying: 0,
    };
  }

  async retryJob(input: unknown): Promise<RetryJobResult> {
    this.retryCalls.push(input);
    return this.retryResult;
  }
}

function scenario(
  role: MembershipRole,
  platformRole: "customer" | "admin" = "customer"
) {
  const authenticated = session(platformRole);
  const organizationId = randomUUID();
  const store = new FakeOperationsStore();
  store.organization = organization(organizationId);
  store.membership = membership(authenticated, organizationId, role);
  const logger = { info: vi.fn() };
  return {
    organizationId,
    service: new OperationsService(
      new FakeAuth(authenticated) as never,
      store,
      logger as never,
      () => new Date("2026-07-30T16:00:00.000Z")
    ),
    store,
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

describe("OperationsService analytics", () => {
  it("maps stored daily projections into a reconciled response", async () => {
    const { organizationId, service } = scenario("finance");
    const result = await service.getOrganizationAnalytics(
      context,
      organizationId,
      {}
    );
    expect(result.range).toEqual({
      from: "2026-07-01",
      to: "2026-07-30",
    });
    expect(result.financials[0]).toMatchObject({
      grossMinor: 5000,
      netMinor: 4000,
      refundMinor: 1000,
    });
    expect(result.funnel).toEqual({
      checkoutStarted: 5,
      holdsCreated: 10,
      paidOrders: 2,
    });
  });

  it("denies financial analytics to a viewer", async () => {
    const { organizationId, service } = scenario("viewer");
    await expectHttpError(
      service.getOrganizationAnalytics(context, organizationId, {}),
      403,
      "forbidden"
    );
  });

  it("rejects ranges longer than one year", async () => {
    const { organizationId, service } = scenario("owner");
    await expectHttpError(
      service.getOrganizationAnalytics(context, organizationId, {
        from: "2025-01-01",
        to: "2026-07-30",
      }),
      400,
      "invalid_request"
    );
  });
});

describe("OperationsService jobs", () => {
  it("requires a platform administrator for the global job view", async () => {
    const { service } = scenario("owner");
    await expectHttpError(service.listPlatformJobs(context), 403, "forbidden");
  });

  it("retries a dead letter with optimistic concurrency", async () => {
    const { organizationId, service, store } = scenario("owner");
    const jobId = randomUUID();
    const expectedUpdatedAt = "2026-07-30T12:00:00.000Z";
    await expect(
      service.retryOrganizationJob(context, organizationId, jobId, {
        expectedUpdatedAt,
      })
    ).resolves.toEqual({ status: "accepted" });
    expect(store.retryCalls).toEqual([
      expect.objectContaining({
        expectedUpdatedAt: new Date(expectedUpdatedAt),
        jobId,
        organizationId,
      }),
    ]);
  });

  it("maps a stale retry onto a conflict", async () => {
    const { organizationId, service, store } = scenario("owner");
    store.retryResult = "conflict";
    await expectHttpError(
      service.retryOrganizationJob(context, organizationId, randomUUID(), {
        expectedUpdatedAt: "2026-07-30T12:00:00.000Z",
      }),
      409,
      "job_conflict"
    );
  });
});
