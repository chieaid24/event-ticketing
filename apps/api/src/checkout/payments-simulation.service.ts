import {
  simulatePaymentRequestSchema,
  type WebhookAck,
} from "@event-ticketing/contracts";
import { OrderNotFoundError } from "@event-ticketing/database";
import {
  buildFakePaymentEvent,
  buildWebhookSignatureHeader,
} from "@event-ticketing/payments";

import type { AuthService, RequestAuthContext } from "../auth/auth.service.js";
import { apiError, parseRequest } from "../request-validation.js";
import type { CheckoutStore } from "./checkout.store.js";
import type { PaymentWebhooksService } from "./payment-webhooks.service.js";

// signed fake events use the production ingest path
export class PaymentsSimulationService {
  constructor(
    private readonly auth: AuthService,
    private readonly store: CheckoutStore,
    private readonly webhooks: PaymentWebhooksService,
    private readonly webhookSecret: string
  ) {}

  async simulate(
    context: RequestAuthContext,
    input: unknown
  ): Promise<WebhookAck> {
    const { user } = await this.auth.requireMutationSession(context);
    const request = parseRequest(simulatePaymentRequestSchema, input);

    let order;
    try {
      order = await this.store.loadOrder({
        actor: { userId: user.id },
        orderId: request.orderId,
      });
    } catch (error) {
      if (error instanceof OrderNotFoundError) {
        apiError(404, "order_not_found", "The order does not exist.");
      }
      throw error;
    }

    const intentId = order.payment.providerPaymentIntentId;
    if (intentId === null) {
      apiError(409, "payment_not_started", "The order has no payment intent.");
    }

    const event = buildFakePaymentEvent({
      amountMinor: order.totalMinor,
      currency: order.currency,
      ...(request.outcome === "fail" && { failureCode: "card_declined" }),
      metadata: { orderId: order.id },
      providerPaymentIntentId: intentId,
      type:
        request.outcome === "succeed"
          ? "payment_intent.succeeded"
          : "payment_intent.payment_failed",
    });
    const payload = JSON.stringify(event);
    const header = buildWebhookSignatureHeader({
      payload,
      secret: this.webhookSecret,
    });

    return this.webhooks.ingest(Buffer.from(payload, "utf8"), header);
  }
}
