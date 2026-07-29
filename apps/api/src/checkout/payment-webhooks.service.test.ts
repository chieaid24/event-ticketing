import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  buildFakePaymentEvent,
  buildWebhookSignatureHeader,
} from "@event-ticketing/payments";

import type { CheckoutStore, WebhookIngestInput } from "./checkout.store.js";
import { PaymentWebhooksService } from "./payment-webhooks.service.js";

const secret = "whsec_test_secret";

function makeStore(): CheckoutStore & { ingested: WebhookIngestInput[] } {
  const ingested: WebhookIngestInput[] = [];
  return {
    attachIntent: vi.fn(),
    createOrder: vi.fn(),
    ingested,
    async ingestWebhookEvent(input) {
      ingested.push(input);
      return { id: "wh-1", replayed: false };
    },
    loadOrder: vi.fn(),
  };
}

function signedDelivery(event: Record<string, unknown>): {
  header: string;
  raw: Buffer;
} {
  const payload = JSON.stringify(event);
  return {
    header: buildWebhookSignatureHeader({ payload, secret }),
    raw: Buffer.from(payload, "utf8"),
  };
}

describe("PaymentWebhooksService.ingest", () => {
  it("records a verified succeeded event and enqueues finalization", async () => {
    const store = makeStore();
    const service = new PaymentWebhooksService(store, "fake", secret);
    const event = buildFakePaymentEvent({
      amountMinor: 4_200,
      currency: "USD",
      metadata: { orderId: "o-1" },
      providerEventId: "evt_1",
      providerPaymentIntentId: "pi_1",
      type: "payment_intent.succeeded",
    });
    const { header, raw } = signedDelivery(event);

    await expect(service.ingest(raw, header)).resolves.toEqual({
      received: true,
    });
    expect(store.ingested).toHaveLength(1);
    const ingested = store.ingested[0]!;
    expect(ingested.providerEventId).toBe("evt_1");
    expect(ingested.enqueue?.topic).toBe("payment.intent.succeeded");
    expect(ingested.enqueue?.payload).toMatchObject({
      amountMinor: 4_200,
      currency: "USD",
      providerPaymentIntentId: "pi_1",
    });
  });

  it("rejects an invalid signature without recording anything", async () => {
    const store = makeStore();
    const service = new PaymentWebhooksService(store, "fake", secret);
    const event = buildFakePaymentEvent({
      amountMinor: 1,
      currency: "USD",
      providerPaymentIntentId: "pi_1",
      type: "payment_intent.succeeded",
    });
    const { raw } = signedDelivery(event);
    const forged = buildWebhookSignatureHeader({
      payload: raw.toString("utf8"),
      secret: "whsec_wrong",
    });

    const error = await service
      .ingest(raw, forged)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(store.ingested).toHaveLength(0);
  });

  it("rejects a missing signature header", async () => {
    const store = makeStore();
    const service = new PaymentWebhooksService(store, "fake", secret);
    const error = await service
      .ingest(Buffer.from("{}"), undefined)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
  });

  it("records an unhandled event type without enqueueing work", async () => {
    const store = makeStore();
    const service = new PaymentWebhooksService(store, "fake", secret);
    const { header, raw } = signedDelivery({
      data: { object: { id: "ch_1" } },
      id: "evt_2",
      type: "charge.updated",
    });

    await service.ingest(raw, header);
    expect(store.ingested).toHaveLength(1);
    expect(store.ingested[0]!.enqueue).toBeNull();
  });

  it("records a failed payment with its failure code", async () => {
    const store = makeStore();
    const service = new PaymentWebhooksService(store, "fake", secret);
    const event = buildFakePaymentEvent({
      amountMinor: 4_200,
      currency: "USD",
      failureCode: "card_declined",
      providerEventId: "evt_3",
      providerPaymentIntentId: "pi_1",
      type: "payment_intent.payment_failed",
    });
    const { header, raw } = signedDelivery(event);

    await service.ingest(raw, header);
    expect(store.ingested[0]!.enqueue?.topic).toBe("payment.intent.failed");
    expect(store.ingested[0]!.enqueue?.payload).toMatchObject({
      failureCode: "card_declined",
    });
  });
});
