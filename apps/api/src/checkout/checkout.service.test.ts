import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  HoldNotCheckoutableError,
  OrderHoldNotFoundError,
  type OrderRecord,
} from "@event-ticketing/database";
import {
  createFakePaymentGateway,
  PaymentGatewayError,
  type PaymentGateway,
} from "@event-ticketing/payments";

import type {
  AuthenticatedSession,
  AuthService,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { CheckoutService } from "./checkout.service.js";
import type { CheckoutStore } from "./checkout.store.js";

const context: RequestAuthContext = {
  csrfToken: "a-valid-csrf-token-value",
  origin: "http://127.0.0.1:3000",
  sessionSecret: "a-valid-session-secret-value",
};

const holdId = "44444444-4444-4444-8444-444444444444";
const orderId = "55555555-5555-4555-8555-555555555555";

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

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    createdAt: new Date("2026-07-29T12:00:00Z"),
    currency: "USD",
    eventId: randomUUID(),
    eventTitle: "Autumn Gala",
    feeMinor: 200,
    holdExpiresAt: new Date("2026-07-29T12:10:00Z"),
    holdId,
    id: orderId,
    items: [
      {
        eventSeatId: null,
        quantity: 2,
        rowLabel: null,
        seatLabel: null,
        sectionName: null,
        ticketTypeId: randomUUID(),
        ticketTypeName: "Floor",
        unitFeeMinor: 100,
        unitPriceMinor: 2_000,
      },
    ],
    paidAt: null,
    payment: {
      amountMinor: 4_200,
      clientSecret: null,
      currency: "USD",
      lastFailureAt: null,
      lastFailureCode: null,
      provider: "fake",
      providerPaymentIntentId: null,
      status: "requires_payment",
    },
    publicNumber: "ET-0123456789AB",
    replayed: false,
    status: "pending_payment",
    subtotalMinor: 4_000,
    ticketCount: 0,
    totalMinor: 4_200,
    ...overrides,
  };
}

function makeService(
  store: CheckoutStore,
  gateway: PaymentGateway = createFakePaymentGateway()
): CheckoutService {
  return new CheckoutService(
    new FakeAuth(makeSession(randomUUID())) as unknown as AuthService,
    store,
    gateway,
    null
  );
}

describe("CheckoutService.startCheckout", () => {
  it("creates the intent under a stable per-order key and stores it", async () => {
    const bare = makeOrder();
    const attach = vi.fn().mockResolvedValue(undefined);
    const withIntent = makeOrder();
    withIntent.payment.providerPaymentIntentId = "pi_fake_1";
    withIntent.payment.clientSecret = "pi_fake_1_secret_2";
    const store: CheckoutStore = {
      attachIntent: attach,
      createOrder: vi.fn().mockResolvedValue(bare),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn().mockResolvedValue(withIntent),
    };
    const gateway = createFakePaymentGateway();
    const expected = await gateway.createPaymentIntent({
      amountMinor: 4_200,
      currency: "USD",
      idempotencyKey: `order:${orderId}`,
    });

    const summary = await makeService(store, gateway).startCheckout(context, {
      holdId,
    });

    expect(attach).toHaveBeenCalledWith({
      clientSecret: expected.clientSecret,
      orderId,
      providerPaymentIntentId: expected.providerPaymentIntentId,
    });
    expect(summary.orderId).toBe(orderId);
    expect(summary.payment.clientSecret).toBe("pi_fake_1_secret_2");
  });

  it("replays an order without touching the provider again", async () => {
    const order = makeOrder({ replayed: true });
    order.payment.providerPaymentIntentId = "pi_fake_1";
    order.payment.clientSecret = "pi_fake_1_secret_2";
    const gateway: PaymentGateway = {
      createPaymentIntent: vi.fn(),
      createRefund: vi.fn(),
      provider: "fake",
    };
    const store: CheckoutStore = {
      attachIntent: vi.fn(),
      createOrder: vi.fn().mockResolvedValue(order),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn(),
    };

    const summary = await makeService(store, gateway).startCheckout(context, {
      holdId,
    });

    expect(gateway.createPaymentIntent).not.toHaveBeenCalled();
    expect(summary.payment.clientSecret).toBe("pi_fake_1_secret_2");
  });

  it("translates an expired hold to a 409", async () => {
    const store: CheckoutStore = {
      attachIntent: vi.fn(),
      createOrder: vi
        .fn()
        .mockRejectedValue(new HoldNotCheckoutableError("expired")),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn(),
    };

    const error = await makeService(store)
      .startCheckout(context, { holdId })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    expect(http.getStatus()).toBe(409);
    expect((http.getResponse() as { code: string }).code).toBe("hold_expired");
  });

  it("translates a foreign hold to a 404", async () => {
    const store: CheckoutStore = {
      attachIntent: vi.fn(),
      createOrder: vi.fn().mockRejectedValue(new OrderHoldNotFoundError()),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn(),
    };

    const error = await makeService(store)
      .startCheckout(context, { holdId })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
  });

  it("keeps the order and reports 502 when the provider is down", async () => {
    const gateway: PaymentGateway = {
      createPaymentIntent: vi
        .fn()
        .mockRejectedValue(new PaymentGatewayError("provider_unreachable")),
      createRefund: vi.fn(),
      provider: "stripe",
    };
    const store: CheckoutStore = {
      attachIntent: vi.fn(),
      createOrder: vi.fn().mockResolvedValue(makeOrder()),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn(),
    };

    const error = await makeService(store, gateway)
      .startCheckout(context, { holdId })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(502);
    expect(store.attachIntent).not.toHaveBeenCalled();
  });

  it("rejects a body with client-supplied commercial fields", async () => {
    const store: CheckoutStore = {
      attachIntent: vi.fn(),
      createOrder: vi.fn(),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn(),
    };

    const error = await makeService(store)
      .startCheckout(context, { holdId, totalMinor: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(store.createOrder).not.toHaveBeenCalled();
  });
});

describe("CheckoutService.getOrder", () => {
  it("never echoes the client secret once payment is final", async () => {
    const order = makeOrder({ status: "paid" });
    order.payment.status = "succeeded";
    order.payment.clientSecret = "pi_fake_1_secret_2";
    order.payment.providerPaymentIntentId = "pi_fake_1";
    const store: CheckoutStore = {
      attachIntent: vi.fn(),
      createOrder: vi.fn(),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn().mockResolvedValue(order),
    };

    const summary = await makeService(store).getOrder(context, orderId);
    expect(summary.payment.clientSecret).toBeNull();
    expect(summary.status).toBe("paid");
  });

  it("rejects a malformed order id without querying", async () => {
    const store: CheckoutStore = {
      attachIntent: vi.fn(),
      createOrder: vi.fn(),
      ingestWebhookEvent: vi.fn(),
      loadOrder: vi.fn(),
    };

    const error = await makeService(store)
      .getOrder(context, "../../etc/passwd")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect(store.loadOrder).not.toHaveBeenCalled();
  });
});
