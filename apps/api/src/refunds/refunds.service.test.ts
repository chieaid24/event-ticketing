import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type {
  MembershipRow,
  OrganizationRow,
  RefundRecord,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { RefundsService } from "./refunds.service.js";
import type { RefundsStore } from "./refunds.store.js";

const context: RequestAuthContext = {
  csrfToken: "csrf",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "session",
};

function session(userId: string): AuthenticatedSession {
  return {
    session: {
      absoluteExpiresAt: new Date(Date.now() + 60_000),
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
      email: "customer@example.test",
      emailVerifiedAt: new Date(),
      id: userId,
      passwordHash: null,
      platformRole: "customer",
      status: "active",
    },
  };
}

function refund(orderId: string, orderItemId: string): RefundRecord {
  return {
    amountMinor: 4200,
    completedAt: null,
    createdAt: new Date(),
    currency: "USD",
    id: randomUUID(),
    initiator: "customer",
    inventoryReturnedAt: null,
    items: [{ amountMinor: 4200, orderItemId, quantity: 1 }],
    orderId,
    providerRefundId: null,
    reason: null,
    status: "requested",
  };
}

function harness(role: MembershipRow["role"] = "finance") {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const orderId = randomUUID();
  const orderItemId = randomUUID();
  const row = refund(orderId, orderItemId);
  const membership: MembershipRow = {
    createdAt: new Date(),
    id: randomUUID(),
    invitedById: null,
    joinedAt: new Date(),
    organizationId,
    role,
    status: "active",
    userId,
  };
  const organization: OrganizationRow = {
    createdAt: new Date(),
    id: organizationId,
    name: "Example",
    slug: "example",
    updatedAt: new Date(),
    version: 1,
  };
  const store: RefundsStore = {
    createCustomerRefund: vi.fn(async () => row),
    createOrganizerRefund: vi.fn(async (): Promise<RefundRecord> => ({
      ...row,
      initiator: "organizer",
      reason: "Customer service adjustment",
    })),
    findMembership: vi.fn(async () => membership),
    findOrganization: vi.fn(async () => organization),
    listCustomerRefunds: vi.fn(async () => [row]),
  };
  const auth = {
    requireMutationSession: vi.fn(async () => session(userId)),
    requireSession: vi.fn(async () => session(userId)),
  };
  return {
    orderId,
    orderItemId,
    organizationId,
    service: new RefundsService(auth, store),
    store,
  };
}

async function errorFrom(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

describe("RefundsService", () => {
  it("requires an idempotency key for a customer request", async () => {
    const test = harness();
    const error = await errorFrom(
      test.service.createCustomerRefund(context, test.orderId, undefined, {
        items: [{ orderItemId: test.orderItemId, quantity: 1 }],
      })
    );
    expect(error.getStatus()).toBe(400);
    expect(test.store.createCustomerRefund).not.toHaveBeenCalled();
  });

  it("allows a finance member to request an organizer refund", async () => {
    const test = harness("finance");
    const result = await test.service.createOrganizerRefund(
      context,
      test.organizationId,
      test.orderId,
      "organizer-refund-1",
      {
        items: [{ orderItemId: test.orderItemId, quantity: 1 }],
        reason: "Customer service adjustment",
      }
    );
    expect(result.initiator).toBe("organizer");
    expect(test.store.createOrganizerRefund).toHaveBeenCalledOnce();
  });

  it("rejects an event manager without finance permission", async () => {
    const test = harness("event_manager");
    const error = await errorFrom(
      test.service.createOrganizerRefund(
        context,
        test.organizationId,
        test.orderId,
        "organizer-refund-1",
        {
          items: [{ orderItemId: test.orderItemId, quantity: 1 }],
          reason: "Customer service adjustment",
        }
      )
    );
    expect(error.getStatus()).toBe(403);
    expect(test.store.createOrganizerRefund).not.toHaveBeenCalled();
  });
});
