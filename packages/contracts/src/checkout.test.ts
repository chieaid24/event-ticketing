import { describe, expect, it } from "vitest";

import {
  createCheckoutRequestSchema,
  createGeneralAdmissionHoldRequestSchema,
  orderSummarySchema,
  simulatePaymentRequestSchema,
} from "./checkout.js";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("createCheckoutRequestSchema", () => {
  it("accepts only a hold id", () => {
    expect(
      createCheckoutRequestSchema.safeParse({ holdId: uuid }).success
    ).toBe(true);
  });

  it("rejects client-supplied commercial fields", () => {
    for (const extra of [
      { amountMinor: 1 },
      { totalMinor: 0 },
      { currency: "USD" },
      { status: "paid" },
    ]) {
      expect(
        createCheckoutRequestSchema.safeParse({ holdId: uuid, ...extra })
          .success
      ).toBe(false);
    }
  });

  it("rejects a malformed hold id", () => {
    expect(
      createCheckoutRequestSchema.safeParse({ holdId: "not-a-uuid" }).success
    ).toBe(false);
  });
});

describe("createGeneralAdmissionHoldRequestSchema", () => {
  it("accepts bounded ticket type quantities", () => {
    const parsed = createGeneralAdmissionHoldRequestSchema.safeParse({
      eventId: uuid,
      items: [{ quantity: 2, ticketTypeId: uuid }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects zero, fractional, oversized, and priced items", () => {
    for (const item of [
      { quantity: 0, ticketTypeId: uuid },
      { quantity: 1.5, ticketTypeId: uuid },
      { quantity: 51, ticketTypeId: uuid },
      { quantity: 1, ticketTypeId: uuid, unitPriceMinor: 1 },
    ]) {
      expect(
        createGeneralAdmissionHoldRequestSchema.safeParse({
          eventId: uuid,
          items: [item],
        }).success
      ).toBe(false);
    }
  });

  it("rejects an empty item list", () => {
    expect(
      createGeneralAdmissionHoldRequestSchema.safeParse({
        eventId: uuid,
        items: [],
      }).success
    ).toBe(false);
  });
});

describe("orderSummarySchema", () => {
  const summary = {
    createdAt: "2026-07-29T12:00:00.000Z",
    currency: "USD",
    eventId: uuid,
    eventTitle: "Autumn Gala",
    feeMinor: 200,
    holdExpiresAt: "2026-07-29T12:10:00.000Z",
    holdId: uuid,
    items: [
      {
        eventSeatId: null,
        quantity: 2,
        rowLabel: null,
        seatLabel: null,
        sectionName: null,
        ticketTypeId: uuid,
        ticketTypeName: "Floor",
        unitFeeMinor: 100,
        unitPriceMinor: 2500,
      },
    ],
    orderId: uuid,
    paidAt: null,
    payment: {
      clientSecret: "pi_fake_abc_secret_def",
      lastFailureAt: null,
      lastFailureCode: null,
      provider: "fake",
      publishableKey: null,
      status: "requires_payment",
    },
    publicNumber: "ET-0123456789AB",
    status: "pending_payment",
    subtotalMinor: 5000,
    ticketCount: 0,
    totalMinor: 5200,
  };

  it("round-trips a pending summary", () => {
    expect(orderSummarySchema.safeParse(summary).success).toBe(true);
  });

  it("rejects unknown fields and negative money", () => {
    expect(
      orderSummarySchema.safeParse({ ...summary, injected: true }).success
    ).toBe(false);
    expect(
      orderSummarySchema.safeParse({ ...summary, totalMinor: -1 }).success
    ).toBe(false);
  });
});

describe("simulatePaymentRequestSchema", () => {
  it("accepts only known outcomes", () => {
    expect(
      simulatePaymentRequestSchema.safeParse({
        orderId: uuid,
        outcome: "succeed",
      }).success
    ).toBe(true);
    expect(
      simulatePaymentRequestSchema.safeParse({
        orderId: uuid,
        outcome: "explode",
      }).success
    ).toBe(false);
  });
});
