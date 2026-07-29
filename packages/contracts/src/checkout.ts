import { z } from "zod";

import { currencySchema, moneyMinorSchema } from "./events.js";

export const MAX_GENERAL_ADMISSION_LINES = 20;
export const MAX_GENERAL_ADMISSION_QUANTITY = 50;

export const orderStatusSchema = z.enum([
  "pending_payment",
  "paid",
  "payment_conflict",
  "refunded",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum([
  "requires_payment",
  "succeeded",
  "refund_pending",
  "refunded",
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentProviderSchema = z.enum(["stripe", "fake"]);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const createGeneralAdmissionHoldRequestSchema = z
  .object({
    eventId: z.uuid(),
    items: z
      .array(
        z
          .object({
            quantity: z
              .number()
              .int()
              .min(1)
              .max(MAX_GENERAL_ADMISSION_QUANTITY),
            ticketTypeId: z.uuid(),
          })
          .strict()
      )
      .min(1)
      .max(MAX_GENERAL_ADMISSION_LINES),
  })
  .strict();
export type CreateGeneralAdmissionHoldRequest = z.infer<
  typeof createGeneralAdmissionHoldRequestSchema
>;

export const generalAdmissionHoldItemSchema = z
  .object({
    quantity: z.number().int().min(1),
    ticketTypeId: z.uuid(),
    unitFeeMinor: moneyMinorSchema,
    unitPriceMinor: moneyMinorSchema,
  })
  .strict();

export const createGeneralAdmissionHoldResponseSchema = z
  .object({
    currency: currencySchema,
    eventId: z.uuid(),
    expiresAt: z.iso.datetime(),
    feeMinor: moneyMinorSchema,
    holdId: z.uuid(),
    items: z.array(generalAdmissionHoldItemSchema),
    status: z.enum([
      "active",
      "checkout_started",
      "consumed",
      "expired",
      "cancelled",
    ]),
    subtotalMinor: moneyMinorSchema,
    totalMinor: moneyMinorSchema,
  })
  .strict();
export type CreateGeneralAdmissionHoldResponse = z.infer<
  typeof createGeneralAdmissionHoldResponseSchema
>;

/** Conflict body: only oversubscribed ticket type ids, never another hold. */
export const capacityUnavailableResponseSchema = z
  .object({
    code: z.literal("capacity_unavailable"),
    message: z.string(),
    ticketTypeIds: z.array(z.uuid()),
  })
  .strict();
export type CapacityUnavailableResponse = z.infer<
  typeof capacityUnavailableResponseSchema
>;

/**
 * Checkout carries only the hold reference. Amounts, fees, currency, and every
 * other commercial value are recalculated server-side from the hold.
 */
export const createCheckoutRequestSchema = z
  .object({ holdId: z.uuid() })
  .strict();
export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequestSchema>;

export const orderItemSchema = z
  .object({
    eventSeatId: z.uuid().nullable(),
    quantity: z.number().int().min(1),
    rowLabel: z.string().nullable(),
    seatLabel: z.string().nullable(),
    sectionName: z.string().nullable(),
    ticketTypeId: z.uuid(),
    ticketTypeName: z.string(),
    unitFeeMinor: moneyMinorSchema,
    unitPriceMinor: moneyMinorSchema,
  })
  .strict();
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderPaymentSchema = z
  .object({
    /** Present only for the order's owner while payment can still proceed. */
    clientSecret: z.string().nullable(),
    lastFailureCode: z.string().nullable(),
    provider: paymentProviderSchema,
    /** Stripe publishable key; null for the fake provider. */
    publishableKey: z.string().nullable(),
    status: paymentStatusSchema,
  })
  .strict();
export type OrderPayment = z.infer<typeof orderPaymentSchema>;

export const orderSummarySchema = z
  .object({
    createdAt: z.iso.datetime(),
    currency: currencySchema,
    eventId: z.uuid(),
    eventTitle: z.string(),
    feeMinor: moneyMinorSchema,
    holdExpiresAt: z.iso.datetime(),
    holdId: z.uuid(),
    items: z.array(orderItemSchema).min(1),
    orderId: z.uuid(),
    paidAt: z.iso.datetime().nullable(),
    payment: orderPaymentSchema,
    publicNumber: z.string().min(1).max(20),
    status: orderStatusSchema,
    subtotalMinor: moneyMinorSchema,
    ticketCount: z.number().int().min(0),
    totalMinor: moneyMinorSchema,
  })
  .strict();
export type OrderSummary = z.infer<typeof orderSummarySchema>;

/**
 * Development-only simulated payment outcome for the fake provider. The
 * simulated delivery still passes signature verification, webhook receipt, and
 * asynchronous finalization.
 */
export const simulatePaymentRequestSchema = z
  .object({
    orderId: z.uuid(),
    outcome: z.enum(["succeed", "fail"]),
  })
  .strict();
export type SimulatePaymentRequest = z.infer<
  typeof simulatePaymentRequestSchema
>;

export const webhookAckSchema = z.object({ received: z.boolean() }).strict();
export type WebhookAck = z.infer<typeof webhookAckSchema>;
