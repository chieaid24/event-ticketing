import { z } from "zod";

import type { WebhookAck } from "@event-ticketing/contracts";
import {
  isHandledPaymentEventType,
  parsePaymentProviderEvent,
  parseRefundProviderEvent,
  verifyWebhookSignatureHeader,
  type PaymentProviderKind,
} from "@event-ticketing/payments";

import { apiError } from "../request-validation.js";
import type { CheckoutStore } from "./checkout.store.js";

export const PAYMENT_SUCCEEDED_TOPIC = "payment.intent.succeeded";
export const PAYMENT_FAILED_TOPIC = "payment.intent.failed";
export const REFUND_SUCCEEDED_TOPIC = "refund.succeeded";
export const REFUND_FAILED_TOPIC = "refund.failed";

/** Minimal identity every recorded provider event must carry. */
const eventIdentitySchema = z
  .object({ id: z.string().min(1).max(120), type: z.string().min(1).max(120) })
  .loose();

export class PaymentWebhooksService {
  constructor(
    private readonly store: CheckoutStore,
    private readonly provider: PaymentProviderKind,
    private readonly webhookSecret: string
  ) {}

  /**
   * Verifies the raw-body signature, durably records the unique event, and
   * commits the asynchronous processing request in the same transaction.
   * Duplicate deliveries acknowledge without recording or enqueueing twice.
   */
  async ingest(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined
  ): Promise<WebhookAck> {
    if (!rawBody || rawBody.length === 0) {
      apiError(400, "invalid_payload", "A raw request body is required.");
    }
    if (!signatureHeader) {
      apiError(400, "invalid_signature", "A signature header is required.");
    }

    const payload = rawBody.toString("utf8");
    const verification = verifyWebhookSignatureHeader({
      header: signatureHeader,
      payload,
      secret: this.webhookSecret,
    });
    if (!verification.valid) {
      apiError(400, "invalid_signature", "The signature is invalid.");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(payload);
    } catch {
      apiError(400, "invalid_payload", "The request body is not JSON.");
    }

    const identity = eventIdentitySchema.safeParse(parsedBody);
    if (!identity.success) {
      apiError(400, "invalid_payload", "The event lacks an id or type.");
    }

    await this.store.ingestWebhookEvent({
      enqueue: this.toEnqueue(identity.data.id, identity.data.type, parsedBody),
      payload: parsedBody,
      provider: this.provider,
      providerEventId: identity.data.id,
      type: identity.data.type,
    });

    return { received: true };
  }

  private toEnqueue(
    providerEventId: string,
    type: string,
    body: unknown
  ): {
    deduplicationKey: string;
    payload: Record<string, unknown>;
    topic: string;
  } | null {
    if (type === "refund.updated") {
      const event = parseRefundProviderEvent(body);
      if (!event) {
        return null;
      }
      const refund = event.data.object;
      const refundId = refund.metadata?.["refundId"];
      if (!refundId) {
        return null;
      }
      const succeeded = refund.status === "succeeded";
      const failed = refund.status === "failed" || refund.status === "canceled";
      if (!succeeded && !failed) {
        return null;
      }
      return {
        deduplicationKey: `refund-webhook:${this.provider}:${providerEventId}`,
        payload: {
          amountMinor: refund.amount,
          currency: refund.currency.toUpperCase(),
          failureCode: refund.failure_reason ?? refund.status,
          providerPaymentIntentId: refund.payment_intent,
          providerRefundId: refund.id,
          refundId,
        },
        topic: succeeded ? REFUND_SUCCEEDED_TOPIC : REFUND_FAILED_TOPIC,
      };
    }
    if (!isHandledPaymentEventType(type)) {
      return null;
    }
    const event = parsePaymentProviderEvent(body);
    if (!event) {
      // Signature-verified but shape-drifted: keep the durable receipt, skip
      // processing, and leave the payload for operators.
      return null;
    }

    const object = event.data.object;
    const succeeded = type === "payment_intent.succeeded";
    return {
      deduplicationKey: `payment-webhook:${this.provider}:${providerEventId}`,
      payload: {
        amountMinor: succeeded
          ? (object.amount_received ?? object.amount ?? 0)
          : (object.amount ?? 0),
        currency: (object.currency ?? "").toUpperCase(),
        failureCode: object.last_payment_error?.code ?? null,
        providerEventId,
        providerPaymentIntentId: object.id,
      },
      topic: succeeded ? PAYMENT_SUCCEEDED_TOPIC : PAYMENT_FAILED_TOPIC,
    };
  }
}
