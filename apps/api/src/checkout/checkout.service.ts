import { HttpException } from "@nestjs/common";

import {
  createCheckoutRequestSchema,
  type OrderSummary,
  type PaymentProvider,
  type SupportedCurrency,
} from "@event-ticketing/contracts";
import {
  HoldNotCheckoutableError,
  OrderHoldNotFoundError,
  OrderNotFoundError,
  type OrderRecord,
} from "@event-ticketing/database";
import {
  PaymentGatewayError,
  type PaymentGateway,
} from "@event-ticketing/payments";

import type { AuthService, RequestAuthContext } from "../auth/auth.service.js";
import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import type { CheckoutStore } from "./checkout.store.js";

export class CheckoutService {
  constructor(
    private readonly auth: AuthService,
    private readonly store: CheckoutStore,
    private readonly gateway: PaymentGateway,
    private readonly stripePublishableKey: string | null
  ) {}

  /**
   * Creates or replays the one order for the caller's hold, then guarantees a
   * provider intent exists for it. The intent is created after the order
   * committed, under a stable per-order idempotency key, so a crash or a
   * duplicate request converges on the same logical intent.
   */
  async startCheckout(
    context: RequestAuthContext,
    input: unknown
  ): Promise<OrderSummary> {
    const { user } = await this.auth.requireMutationSession(context);
    const request = parseRequest(createCheckoutRequestSchema, input);

    let order: OrderRecord;
    try {
      order = await this.store.createOrder({
        actor: { userId: user.id },
        holdId: request.holdId,
        provider: this.gateway.provider,
      });
    } catch (error) {
      this.translate(error);
    }

    if (
      order.status === "pending_payment" &&
      order.payment.providerPaymentIntentId === null
    ) {
      order = await this.ensureIntent(order, { userId: user.id });
    }

    return this.toResponse(order);
  }

  async getOrder(
    context: RequestAuthContext,
    orderId: string
  ): Promise<OrderSummary> {
    const { user } = await this.auth.requireSession(context);
    if (!uuidPattern.test(orderId)) {
      apiError(404, "order_not_found", "The order does not exist.");
    }

    try {
      const order = await this.store.loadOrder({
        actor: { userId: user.id },
        orderId,
      });
      return this.toResponse(order);
    } catch (error) {
      this.translate(error);
    }
  }

  private async ensureIntent(
    order: OrderRecord,
    actor: { userId: string }
  ): Promise<OrderRecord> {
    try {
      const intent = await this.gateway.createPaymentIntent({
        amountMinor: order.totalMinor,
        currency: order.currency,
        idempotencyKey: `order:${order.id}`,
        metadata: { orderId: order.id, publicNumber: order.publicNumber },
      });
      await this.store.attachIntent({
        clientSecret: intent.clientSecret,
        orderId: order.id,
        providerPaymentIntentId: intent.providerPaymentIntentId,
      });
      return this.store.loadOrder({ actor, orderId: order.id });
    } catch (error) {
      if (error instanceof PaymentGatewayError) {
        // The order stands; a retried checkout resumes at intent creation.
        apiError(
          502,
          "payment_provider_unavailable",
          "The payment provider is unavailable. Try again."
        );
      }
      throw error;
    }
  }

  private toResponse(order: OrderRecord): OrderSummary {
    const paymentOpen =
      order.status === "pending_payment" &&
      order.payment.status === "requires_payment";
    return {
      createdAt: order.createdAt.toISOString(),
      currency: order.currency as SupportedCurrency,
      eventId: order.eventId,
      eventTitle: order.eventTitle,
      feeMinor: order.feeMinor,
      holdExpiresAt: order.holdExpiresAt.toISOString(),
      items: order.items.map((item) => ({
        eventSeatId: item.eventSeatId,
        quantity: item.quantity,
        rowLabel: item.rowLabel,
        seatLabel: item.seatLabel,
        sectionName: item.sectionName,
        ticketTypeId: item.ticketTypeId,
        ticketTypeName: item.ticketTypeName,
        unitFeeMinor: item.unitFeeMinor,
        unitPriceMinor: item.unitPriceMinor,
      })),
      orderId: order.id,
      paidAt: order.paidAt?.toISOString() ?? null,
      payment: {
        // The secret only serves an open payment; final orders never echo it.
        clientSecret: paymentOpen ? order.payment.clientSecret : null,
        lastFailureCode: order.payment.lastFailureCode,
        provider: order.payment.provider as PaymentProvider,
        publishableKey:
          order.payment.provider === "stripe"
            ? this.stripePublishableKey
            : null,
        status: order.payment.status,
      },
      publicNumber: order.publicNumber,
      status: order.status,
      subtotalMinor: order.subtotalMinor,
      ticketCount: order.ticketCount,
      totalMinor: order.totalMinor,
    };
  }

  private translate(error: unknown): never {
    if (error instanceof OrderHoldNotFoundError) {
      apiError(404, "hold_not_found", "The hold does not exist.");
    }
    if (error instanceof HoldNotCheckoutableError) {
      if (error.status === "expired") {
        apiError(409, "hold_expired", "The hold has expired.");
      }
      throw new HttpException(
        {
          code: "hold_not_checkoutable",
          message: "The hold can no longer start checkout.",
          status: error.status,
        },
        409
      );
    }
    if (error instanceof OrderNotFoundError) {
      apiError(404, "order_not_found", "The order does not exist.");
    }
    throw error;
  }
}
