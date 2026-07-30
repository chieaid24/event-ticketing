import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createOrganizerRefundRequestSchema,
  createRefundRequestSchema,
  refundSummarySchema,
} from "./refunds.js";

describe("refund contracts", () => {
  it("accepts item quantities and rejects duplicate order item lines", () => {
    const orderItemId = randomUUID();
    expect(
      createRefundRequestSchema.parse({
        items: [{ orderItemId, quantity: 2 }],
      })
    ).toEqual({ items: [{ orderItemId, quantity: 2 }] });
    expect(
      createRefundRequestSchema.safeParse({
        items: [
          { orderItemId, quantity: 1 },
          { orderItemId, quantity: 1 },
        ],
      }).success
    ).toBe(false);
  });

  it("requires a reason for an organizer refund", () => {
    expect(
      createOrganizerRefundRequestSchema.safeParse({
        items: [{ orderItemId: randomUUID(), quantity: 1 }],
        reason: " ",
      }).success
    ).toBe(false);
  });

  it("keeps provider references out of the public refund summary", () => {
    const parsed = refundSummarySchema.parse({
      amountMinor: 4200,
      completedAt: null,
      createdAt: new Date().toISOString(),
      currency: "USD",
      id: randomUUID(),
      initiator: "customer",
      inventoryReturnedAt: null,
      items: [
        {
          amountMinor: 4200,
          orderItemId: randomUUID(),
          quantity: 1,
        },
      ],
      orderId: randomUUID(),
      reason: null,
      status: "requested",
    });
    expect("providerRefundId" in parsed).toBe(false);
  });
});
