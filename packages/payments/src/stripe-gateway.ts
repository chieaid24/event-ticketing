import Stripe from "stripe";

import { PaymentGatewayError, type PaymentGateway } from "./gateway.js";

function toGatewayError(error: unknown): PaymentGatewayError {
  if (error instanceof Stripe.errors.StripeError) {
    return new PaymentGatewayError(
      error.code ?? error.type,
      // provider messages operator-safe; no card data
      error.message
    );
  }
  return new PaymentGatewayError("provider_unreachable");
}

export function createStripePaymentGateway(input: {
  secretKey: string;
}): PaymentGateway {
  const stripe = new Stripe(input.secretKey);

  return {
    provider: "stripe",
    async createPaymentIntent(request) {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: request.amountMinor,
            automatic_payment_methods: { enabled: true },
            currency: request.currency.toLowerCase(),
            metadata: request.metadata ?? {},
          },
          { idempotencyKey: request.idempotencyKey }
        );
        if (intent.client_secret === null) {
          throw new PaymentGatewayError("intent_missing_client_secret");
        }
        return {
          clientSecret: intent.client_secret,
          providerPaymentIntentId: intent.id,
        };
      } catch (error) {
        if (error instanceof PaymentGatewayError) {
          throw error;
        }
        throw toGatewayError(error);
      }
    },
    async createRefund(request) {
      try {
        const refund = await stripe.refunds.create(
          {
            amount: request.amountMinor,
            metadata: request.metadata ?? {},
            payment_intent: request.providerPaymentIntentId,
          },
          { idempotencyKey: request.idempotencyKey }
        );
        return {
          providerRefundId: refund.id,
          settled: refund.status === "succeeded",
        };
      } catch (error) {
        throw toGatewayError(error);
      }
    },
  };
}
