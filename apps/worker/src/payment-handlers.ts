import type { Pool } from "pg";

import {
  applyRefundResult,
  enqueueOutboxEvent,
  finalizeOrderPayment,
  findUserById,
  loadCompensationTarget,
  markWebhookEventProcessed,
  OrderNotFoundError,
  PaymentNotFoundError,
  PaymentVerificationError,
  recordPaymentFailure,
  withDatabaseTransaction,
  type OutboxEvent,
} from "@event-ticketing/database";
import {
  PaymentGatewayError,
  type PaymentGateway,
} from "@event-ticketing/payments";

import type { AuthEmailer } from "./mailer.js";
import { OutboxHandlerError, type OutboxHandler } from "./outbox-processor.js";

export const PAYMENT_SUCCEEDED_TOPIC = "payment.intent.succeeded";
export const PAYMENT_FAILED_TOPIC = "payment.intent.failed";
export const PAYMENT_COMPENSATION_TOPIC = "payment.compensation.requested";

export interface PaymentHandlerDependencies {
  emailer: AuthEmailer;
  gateway: PaymentGateway;
  opsAlertEmail: string;
  pool: Pool;
}

interface WebhookPayload {
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  providerPaymentIntentId: string;
  webhookEventId: string;
}

function requireWebhookPayload(event: OutboxEvent): WebhookPayload {
  const payload = event.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("providerPaymentIntentId" in payload) ||
    typeof payload.providerPaymentIntentId !== "string" ||
    !("webhookEventId" in payload) ||
    typeof payload.webhookEventId !== "string" ||
    !("amountMinor" in payload) ||
    typeof payload.amountMinor !== "number" ||
    !("currency" in payload) ||
    typeof payload.currency !== "string"
  ) {
    throw new OutboxHandlerError("invalid_event_payload");
  }
  const failureCode =
    "failureCode" in payload && typeof payload.failureCode === "string"
      ? payload.failureCode
      : null;
  return {
    amountMinor: payload.amountMinor,
    currency: payload.currency,
    failureCode,
    providerPaymentIntentId: payload.providerPaymentIntentId,
    webhookEventId: payload.webhookEventId,
  };
}

function requireOrderId(event: OutboxEvent): string {
  if (
    typeof event.payload !== "object" ||
    event.payload === null ||
    !("orderId" in event.payload) ||
    typeof event.payload.orderId !== "string"
  ) {
    throw new OutboxHandlerError("invalid_event_payload");
  }
  return event.payload.orderId;
}

function formatAmount(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

async function sendOrFail(
  emailer: AuthEmailer,
  message: { subject: string; text: string; to: string }
): Promise<void> {
  try {
    await emailer.send(message);
  } catch {
    throw new OutboxHandlerError("email_send_failed");
  }
}

/**
 * Handlers for verified payment webhook processing. Every handler is
 * idempotent under redelivery: finalization short-circuits on a final order,
 * compensation reuses one refund idempotency key, and failure recording is a
 * no-op once the order left pending payment.
 */
export function createPaymentHandlers(
  dependencies: PaymentHandlerDependencies
): Readonly<Record<string, OutboxHandler>> {
  const succeededHandler: OutboxHandler = async (event) => {
    const payload = requireWebhookPayload(event);
    await withDatabaseTransaction(dependencies.pool, async (transaction) => {
      let outcome;
      try {
        outcome = await finalizeOrderPayment(transaction, {
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          providerPaymentIntentId: payload.providerPaymentIntentId,
        });
      } catch (error) {
        if (error instanceof PaymentNotFoundError) {
          throw new OutboxHandlerError("payment_not_found");
        }
        if (error instanceof PaymentVerificationError) {
          throw new OutboxHandlerError("payment_verification_failed");
        }
        throw error;
      }

      if (outcome.outcome === "conflict") {
        // Compensation is requested in the same transaction that recorded the
        // conflict; the dedup key keeps redeliveries to one refund request.
        await enqueueOutboxEvent(transaction, {
          aggregateId: outcome.orderId,
          aggregateType: "order",
          deduplicationKey: `payment-compensation:${outcome.orderId}`,
          payload: { orderId: outcome.orderId },
          topic: PAYMENT_COMPENSATION_TOPIC,
        });
      }
      await markWebhookEventProcessed(transaction, payload.webhookEventId);
    });
  };

  const failedHandler: OutboxHandler = async (event) => {
    const payload = requireWebhookPayload(event);
    await withDatabaseTransaction(dependencies.pool, async (transaction) => {
      try {
        await recordPaymentFailure(transaction, {
          failureCode: payload.failureCode ?? "payment_failed",
          providerPaymentIntentId: payload.providerPaymentIntentId,
        });
      } catch (error) {
        if (error instanceof PaymentNotFoundError) {
          throw new OutboxHandlerError("payment_not_found");
        }
        throw error;
      }
      await markWebhookEventProcessed(transaction, payload.webhookEventId);
    });
  };

  const compensationHandler: OutboxHandler = async (event) => {
    const orderId = requireOrderId(event);
    let target;
    try {
      target = await loadCompensationTarget(dependencies.pool, orderId);
    } catch (error) {
      if (error instanceof OrderNotFoundError) {
        throw new OutboxHandlerError("order_not_found");
      }
      throw error;
    }
    if (target.paymentStatus === "refunded") {
      return;
    }
    if (target.providerPaymentIntentId === null) {
      throw new OutboxHandlerError("missing_provider_reference");
    }

    let refund;
    try {
      // Provider call outside any transaction; the stable key makes retries
      // converge on one logical refund.
      refund = await dependencies.gateway.createRefund({
        idempotencyKey: `refund:order:${orderId}`,
        metadata: { orderId, reason: "inventory_lost" },
        providerPaymentIntentId: target.providerPaymentIntentId,
      });
    } catch (error) {
      if (error instanceof PaymentGatewayError) {
        throw new OutboxHandlerError("refund_request_failed");
      }
      throw error;
    }

    await withDatabaseTransaction(dependencies.pool, (transaction) =>
      applyRefundResult(transaction, {
        orderId,
        providerRefundId: refund.providerRefundId,
        settled: refund.settled,
      })
    );

    const amount = formatAmount(target.amountMinor, target.currency);
    if (target.userId !== null) {
      const user = await findUserById(dependencies.pool, target.userId);
      if (user) {
        await sendOrFail(dependencies.emailer, {
          subject: `Your order ${target.publicNumber} was refunded`,
          text: [
            `Your payment of ${amount} for order ${target.publicNumber}`,
            "succeeded after the reserved inventory was released, so we",
            "started a full refund. No tickets were issued and you were",
            "not charged.",
            "",
            "The refund reaches your payment method within a few business",
            "days. We are sorry about the inconvenience.",
          ].join("\n"),
          to: user.email,
        });
      }
    }
    await sendOrFail(dependencies.emailer, {
      subject: `Payment conflict on order ${target.publicNumber}`,
      text: [
        `Order ${target.publicNumber} (${orderId}) captured ${amount}`,
        "after its inventory was lost. A full refund was requested",
        `(${refund.providerRefundId}). Verify the refund settles and review`,
        "the hold expiry grace configuration if this recurs.",
      ].join("\n"),
      to: dependencies.opsAlertEmail,
    });
  };

  return {
    [PAYMENT_COMPENSATION_TOPIC]: compensationHandler,
    [PAYMENT_FAILED_TOPIC]: failedHandler,
    [PAYMENT_SUCCEEDED_TOPIC]: succeededHandler,
  };
}
