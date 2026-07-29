import { describe, expect, it } from "vitest";

import {
  buildFakePaymentEvent,
  buildWebhookSignatureHeader,
  createFakePaymentGateway,
  parsePaymentProviderEvent,
  verifyWebhookSignatureHeader,
} from "./index.js";

const secret = "whsec_test_secret";
const payload = JSON.stringify({
  id: "evt_1",
  type: "payment_intent.succeeded",
});

describe("webhook signature verification", () => {
  it("accepts a header it built itself", () => {
    const header = buildWebhookSignatureHeader({ payload, secret });
    expect(verifyWebhookSignatureHeader({ header, payload, secret })).toEqual({
      valid: true,
    });
  });

  it("rejects a tampered payload", () => {
    const header = buildWebhookSignatureHeader({ payload, secret });
    const result = verifyWebhookSignatureHeader({
      header,
      payload: payload.replace("succeeded", "failed"),
      secret,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects a wrong secret", () => {
    const header = buildWebhookSignatureHeader({ payload, secret });
    const result = verifyWebhookSignatureHeader({
      header,
      payload,
      secret: "whsec_other",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a stale timestamp beyond tolerance", () => {
    const staleSeconds = Math.floor(Date.now() / 1000) - 3600;
    const header = buildWebhookSignatureHeader({
      payload,
      secret,
      timestampSeconds: staleSeconds,
    });
    const result = verifyWebhookSignatureHeader({ header, payload, secret });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("timestamp_out_of_range");
  });

  it("rejects malformed headers", () => {
    for (const header of ["", "t=,v1=", "v1=abc", "t=123", "nonsense"]) {
      const result = verifyWebhookSignatureHeader({ header, payload, secret });
      expect(result.valid).toBe(false);
    }
  });

  it("accepts any valid v1 candidate among several", () => {
    const header = buildWebhookSignatureHeader({ payload, secret });
    const withDecoy = `${header},v1=${"0".repeat(64)}`;
    expect(
      verifyWebhookSignatureHeader({ header: withDecoy, payload, secret }).valid
    ).toBe(true);
  });
});

describe("fake payment gateway", () => {
  it("returns the same logical intent for a repeated idempotency key", async () => {
    const gateway = createFakePaymentGateway();
    const first = await gateway.createPaymentIntent({
      amountMinor: 4200,
      currency: "USD",
      idempotencyKey: "order:abc",
    });
    const second = await gateway.createPaymentIntent({
      amountMinor: 4200,
      currency: "USD",
      idempotencyKey: "order:abc",
    });
    expect(second).toEqual(first);
    expect(first.providerPaymentIntentId).toMatch(/^pi_fake_/);
  });

  it("derives distinct intents for distinct keys", async () => {
    const gateway = createFakePaymentGateway();
    const first = await gateway.createPaymentIntent({
      amountMinor: 100,
      currency: "USD",
      idempotencyKey: "order:a",
    });
    const second = await gateway.createPaymentIntent({
      amountMinor: 100,
      currency: "USD",
      idempotencyKey: "order:b",
    });
    expect(second.providerPaymentIntentId).not.toBe(
      first.providerPaymentIntentId
    );
  });

  it("settles refunds immediately and idempotently", async () => {
    const gateway = createFakePaymentGateway();
    const first = await gateway.createRefund({
      idempotencyKey: "refund:order:abc",
      providerPaymentIntentId: "pi_fake_x",
    });
    const second = await gateway.createRefund({
      idempotencyKey: "refund:order:abc",
      providerPaymentIntentId: "pi_fake_x",
    });
    expect(first.settled).toBe(true);
    expect(second).toEqual(first);
  });
});

describe("provider event parsing", () => {
  it("parses a fake event it built itself", () => {
    const event = buildFakePaymentEvent({
      amountMinor: 4200,
      currency: "USD",
      metadata: { orderId: "o-1" },
      providerPaymentIntentId: "pi_fake_1",
      type: "payment_intent.succeeded",
    });
    const parsed = parsePaymentProviderEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.data.object.amount_received).toBe(4200);
    expect(parsed!.data.object.currency).toBe("usd");
  });

  it("rejects shapes without an event or object id", () => {
    expect(parsePaymentProviderEvent({ type: "x" })).toBeNull();
    expect(
      parsePaymentProviderEvent({ data: { object: {} }, id: "evt", type: "x" })
    ).toBeNull();
  });
});
