import { z } from "zod";

/**
 * The minimal, provider-shaped slice of a payment event that finalization
 * consumes. Extra fields pass through unvalidated; nothing commercial is
 * trusted from here without re-verification against the stored order.
 */
export const paymentProviderEventSchema = z
  .object({
    data: z.object({
      object: z
        .object({
          amount: z.number().int().nonnegative().optional(),
          amount_received: z.number().int().nonnegative().optional(),
          currency: z.string().length(3).optional(),
          id: z.string().min(1).max(120),
          last_payment_error: z
            .object({ code: z.string().max(80).optional() })
            .nullish(),
          metadata: z.record(z.string(), z.string()).optional(),
          status: z.string().max(40).optional(),
        })
        .loose(),
    }),
    id: z.string().min(1).max(120),
    type: z.string().min(1).max(120),
  })
  .loose();

export type PaymentProviderEvent = z.infer<typeof paymentProviderEventSchema>;

export const refundProviderEventSchema = z
  .object({
    data: z.object({
      object: z
        .object({
          amount: z.number().int().positive(),
          currency: z.string().length(3),
          failure_reason: z.string().max(80).nullish(),
          id: z.string().min(1).max(120),
          metadata: z.record(z.string(), z.string()).optional(),
          payment_intent: z.string().min(1).max(120),
          status: z.string().max(40),
        })
        .loose(),
    }),
    id: z.string().min(1).max(120),
    type: z.literal("refund.updated"),
  })
  .loose();

export type RefundProviderEvent = z.infer<typeof refundProviderEventSchema>;

export function parsePaymentProviderEvent(
  payload: unknown
): PaymentProviderEvent | null {
  const result = paymentProviderEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}

export function parseRefundProviderEvent(
  payload: unknown
): RefundProviderEvent | null {
  const result = refundProviderEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}

/** Event types the platform reacts to; anything else is recorded and skipped. */
export const HANDLED_PAYMENT_EVENT_TYPES = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
] as const;

export type HandledPaymentEventType =
  (typeof HANDLED_PAYMENT_EVENT_TYPES)[number];

export function isHandledPaymentEventType(
  type: string
): type is HandledPaymentEventType {
  return (HANDLED_PAYMENT_EVENT_TYPES as readonly string[]).includes(type);
}
