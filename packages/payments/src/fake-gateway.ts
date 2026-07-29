import { createHmac, randomBytes } from "node:crypto";

import type { PaymentGateway } from "./gateway.js";

/**
 * Deterministic in-process provider for development and CI, where no Stripe
 * credential exists. Identifiers derive from the idempotency key, so a
 * replayed call returns the same logical intent or refund exactly as the real
 * provider would. Payment outcomes arrive through simulated, signed webhook
 * deliveries on the production verification path.
 */
export function createFakePaymentGateway(
  input: { seed?: string } = {}
): PaymentGateway {
  const seed = input.seed ?? "fake-payment-gateway";
  const derive = (kind: string, key: string): string =>
    createHmac("sha256", seed)
      .update(`${kind}:${key}`)
      .digest("hex")
      .slice(0, 24);

  return {
    provider: "fake",
    async createPaymentIntent(request) {
      const id = `pi_fake_${derive("intent", request.idempotencyKey)}`;
      return {
        clientSecret: `${id}_secret_${derive("secret", request.idempotencyKey)}`,
        providerPaymentIntentId: id,
      };
    },
    async createRefund(request) {
      return {
        providerRefundId: `re_fake_${derive("refund", request.idempotencyKey)}`,
        settled: true,
      };
    },
  };
}

/** Builds a provider-shaped payment event for simulated webhook deliveries. */
export function buildFakePaymentEvent(input: {
  amountMinor: number;
  currency: string;
  failureCode?: string;
  metadata?: Record<string, string>;
  providerEventId?: string;
  providerPaymentIntentId: string;
  type: "payment_intent.succeeded" | "payment_intent.payment_failed";
}): Record<string, unknown> {
  const succeeded = input.type === "payment_intent.succeeded";
  return {
    data: {
      object: {
        amount: input.amountMinor,
        amount_received: succeeded ? input.amountMinor : 0,
        currency: input.currency.toLowerCase(),
        id: input.providerPaymentIntentId,
        last_payment_error: succeeded
          ? null
          : { code: input.failureCode ?? "card_declined" },
        metadata: input.metadata ?? {},
        object: "payment_intent",
        status: succeeded ? "succeeded" : "requires_payment_method",
      },
    },
    id: input.providerEventId ?? `evt_fake_${randomBytes(12).toString("hex")}`,
    object: "event",
    type: input.type,
  };
}
