import type { Pool } from "pg";

import {
  attachRefundProviderReference,
  finalizeRefund,
  loadNotification,
  loadRefundTarget,
  markNotificationSent,
  markRefundProviderFailure,
  markWebhookEventProcessed,
  queueOrderNotification,
  recordNotificationFailure,
  RefundNotFoundError,
  RefundStateError,
  suppressNotification,
  withDatabaseTransaction,
  type OutboxEvent,
} from "@event-ticketing/database";
import {
  PaymentGatewayError,
  type PaymentGateway,
} from "@event-ticketing/payments";

import type { AuthEmailer } from "./mailer.js";
import { PermanentEmailError } from "./mailer.js";
import { OutboxHandlerError, type OutboxHandler } from "./outbox-processor.js";

export const REFUND_REQUESTED_TOPIC = "refund.requested";
export const REFUND_SUCCEEDED_TOPIC = "refund.succeeded";
export const REFUND_FAILED_TOPIC = "refund.failed";
export const NOTIFICATION_SEND_TOPIC = "notification.send";

function requiredId(
  event: OutboxEvent,
  field: "notificationId" | "refundId"
): string {
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null || !(field in payload)) {
    throw new OutboxHandlerError("invalid_event_payload");
  }
  const value = (payload as Record<string, unknown>)[field];
  if (typeof value !== "string") {
    throw new OutboxHandlerError("invalid_event_payload");
  }
  return value;
}

function requireRefundWebhook(event: OutboxEvent): {
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  providerPaymentIntentId: string;
  providerRefundId: string;
  refundId: string;
  webhookEventId: string;
} {
  const payload = event.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("amountMinor" in payload) ||
    typeof payload.amountMinor !== "number" ||
    !("currency" in payload) ||
    typeof payload.currency !== "string" ||
    !("failureCode" in payload) ||
    (payload.failureCode !== null && typeof payload.failureCode !== "string") ||
    !("providerPaymentIntentId" in payload) ||
    typeof payload.providerPaymentIntentId !== "string" ||
    !("providerRefundId" in payload) ||
    typeof payload.providerRefundId !== "string" ||
    !("refundId" in payload) ||
    typeof payload.refundId !== "string" ||
    !("webhookEventId" in payload) ||
    typeof payload.webhookEventId !== "string"
  ) {
    throw new OutboxHandlerError("invalid_event_payload");
  }
  return {
    amountMinor: payload.amountMinor,
    currency: payload.currency,
    failureCode: payload.failureCode,
    providerPaymentIntentId: payload.providerPaymentIntentId,
    providerRefundId: payload.providerRefundId,
    refundId: payload.refundId,
    webhookEventId: payload.webhookEventId,
  };
}

function refundMessage(target: Awaited<ReturnType<typeof loadRefundTarget>>): {
  subject: string;
  text: string;
} {
  const amount = `${(target.amountMinor / 100).toFixed(2)} ${target.currency}`;
  return {
    subject: `Refund confirmed for order ${target.orderPublicNumber}`,
    text: [
      `Your ${amount} refund for ${target.eventTitle} is confirmed.`,
      `Order: ${target.orderPublicNumber}`,
      "",
      "Refunded tickets are no longer valid for admission.",
    ].join("\n"),
  };
}

function refundFailureMessage(
  target: Awaited<ReturnType<typeof loadRefundTarget>>
): { subject: string; text: string } {
  return {
    subject: `Refund failed for order ${target.orderPublicNumber}`,
    text: [
      `The refund for ${target.eventTitle} could not be completed.`,
      `Order: ${target.orderPublicNumber}`,
      "",
      "No refund was applied. You can retry the request or contact support.",
    ].join("\n"),
  };
}

async function finalizeAndNotify(
  pool: Pool,
  input: {
    amountMinor: number;
    currency: string;
    providerPaymentIntentId: string;
    providerRefundId: string;
    refundId: string;
    webhookEventId?: string;
  }
): Promise<void> {
  const target = await loadRefundTarget(pool, input.refundId);
  await withDatabaseTransaction(pool, async (transaction) => {
    const result = await finalizeRefund(transaction, input);
    if (!result.replayed) {
      const message = refundMessage(target);
      await queueOrderNotification(transaction, {
        deduplicationKey: `refund.confirmation:${input.refundId}`,
        kind: "refund_confirmation",
        orderId: result.orderId,
        subject: message.subject,
        text: message.text,
      });
    }
    if (input.webhookEventId) {
      await markWebhookEventProcessed(transaction, input.webhookEventId);
    }
  });
}

async function failAndNotify(
  pool: Pool,
  input: ReturnType<typeof requireRefundWebhook>
): Promise<void> {
  const target = await loadRefundTarget(pool, input.refundId);
  await withDatabaseTransaction(pool, async (transaction) => {
    const result = await markRefundProviderFailure(transaction, {
      ...input,
      code: input.failureCode ?? "provider_refund_failed",
    });
    if (!result.replayed) {
      const message = refundFailureMessage(target);
      await queueOrderNotification(transaction, {
        deduplicationKey: `refund.failed:${input.refundId}`,
        kind: "refund_failed",
        orderId: result.orderId,
        subject: message.subject,
        text: message.text,
      });
    }
    await markWebhookEventProcessed(transaction, input.webhookEventId);
  });
}

export function createRefundHandlers(input: {
  emailer: AuthEmailer;
  gateway: PaymentGateway;
  pool: Pool;
}): Readonly<Record<string, OutboxHandler>> {
  const requested: OutboxHandler = async (event) => {
    const refundId = requiredId(event, "refundId");
    let target;
    try {
      target = await loadRefundTarget(input.pool, refundId);
    } catch (error) {
      if (error instanceof RefundNotFoundError) {
        throw new OutboxHandlerError("refund_not_found");
      }
      throw error;
    }
    if (target.status === "succeeded" || target.status === "failed") {
      return;
    }
    if (!target.providerPaymentIntentId) {
      throw new OutboxHandlerError("missing_provider_reference");
    }

    let providerRefundId = target.providerRefundId;
    let settled = false;
    if (!providerRefundId) {
      try {
        const created = await input.gateway.createRefund({
          amountMinor: target.amountMinor,
          idempotencyKey: `refund:${target.id}`,
          metadata: {
            orderId: target.orderId,
            refundId: target.id,
          },
          providerPaymentIntentId: target.providerPaymentIntentId,
        });
        providerRefundId = created.providerRefundId;
        settled = created.settled;
      } catch (error) {
        if (error instanceof PaymentGatewayError) {
          throw new OutboxHandlerError("refund_request_failed");
        }
        throw error;
      }
      try {
        await withDatabaseTransaction(input.pool, (transaction) =>
          attachRefundProviderReference(transaction, {
            providerRefundId: providerRefundId!,
            refundId,
          })
        );
      } catch (error) {
        if (error instanceof RefundStateError) {
          throw new OutboxHandlerError(error.code);
        }
        throw error;
      }
    }

    if (input.gateway.provider === "fake" && settled) {
      await finalizeAndNotify(input.pool, {
        amountMinor: target.amountMinor,
        currency: target.currency,
        providerPaymentIntentId: target.providerPaymentIntentId,
        providerRefundId,
        refundId,
      });
    }
  };

  const succeeded: OutboxHandler = async (event) => {
    const payload = requireRefundWebhook(event);
    try {
      await finalizeAndNotify(input.pool, payload);
    } catch (error) {
      if (error instanceof RefundNotFoundError) {
        throw new OutboxHandlerError("refund_not_found");
      }
      if (error instanceof RefundStateError) {
        throw new OutboxHandlerError(error.code);
      }
      throw error;
    }
  };

  const failed: OutboxHandler = async (event) => {
    const payload = requireRefundWebhook(event);
    try {
      await failAndNotify(input.pool, payload);
    } catch (error) {
      if (error instanceof RefundNotFoundError) {
        throw new OutboxHandlerError("refund_not_found");
      }
      if (error instanceof RefundStateError) {
        throw new OutboxHandlerError(error.code);
      }
      throw error;
    }
  };

  const sendNotification: OutboxHandler = async (event) => {
    const notificationId = requiredId(event, "notificationId");
    const notification = await loadNotification(input.pool, notificationId);
    if (!notification) {
      throw new OutboxHandlerError("notification_not_found");
    }
    if (
      notification.status === "sent" ||
      notification.status === "suppressed"
    ) {
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notification.recipientEmail)) {
      await suppressNotification(input.pool, {
        code: "invalid_recipient",
        notificationId,
      });
      return;
    }
    try {
      await input.emailer.send({
        subject: notification.subject,
        text: notification.text,
        to: notification.recipientEmail,
      });
    } catch (error) {
      if (error instanceof PermanentEmailError) {
        await suppressNotification(input.pool, {
          code: "recipient_rejected",
          notificationId,
        });
        return;
      }
      await recordNotificationFailure(input.pool, {
        code: "email_send_failed",
        notificationId,
      });
      throw new OutboxHandlerError("email_send_failed");
    }
    await markNotificationSent(input.pool, notificationId);
  };

  return {
    [NOTIFICATION_SEND_TOPIC]: sendNotification,
    [REFUND_FAILED_TOPIC]: failed,
    [REFUND_REQUESTED_TOPIC]: requested,
    [REFUND_SUCCEEDED_TOPIC]: succeeded,
  };
}
