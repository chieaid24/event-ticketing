import { z } from "zod";

import { currencySchema, moneyMinorSchema } from "./events.js";

export const MAX_REFUND_LINES = 20;
export const MAX_REFUND_QUANTITY = 50;

export const refundStatusSchema = z.enum([
  "requested",
  "provider_pending",
  "succeeded",
  "failed",
]);

export const refundInitiatorSchema = z.enum(["customer", "organizer"]);

export const refundItemRequestSchema = z
  .object({
    orderItemId: z.uuid(),
    quantity: z.number().int().min(1).max(MAX_REFUND_QUANTITY),
  })
  .strict();

const refundItemsSchema = z
  .array(refundItemRequestSchema)
  .min(1)
  .max(MAX_REFUND_LINES)
  .refine(
    (items) =>
      new Set(items.map((item) => item.orderItemId)).size === items.length,
    { message: "Each order item may appear once." }
  );

export const createRefundRequestSchema = z
  .object({ items: refundItemsSchema })
  .strict();

export const createOrganizerRefundRequestSchema = z
  .object({
    items: refundItemsSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const refundItemSchema = z
  .object({
    amountMinor: moneyMinorSchema,
    orderItemId: z.uuid(),
    quantity: z.number().int().min(1),
  })
  .strict();

export const refundSummarySchema = z
  .object({
    amountMinor: moneyMinorSchema,
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    currency: currencySchema,
    id: z.uuid(),
    initiator: refundInitiatorSchema,
    inventoryReturnedAt: z.iso.datetime().nullable(),
    items: z.array(refundItemSchema).min(1),
    orderId: z.uuid(),
    reason: z.string().nullable(),
    status: refundStatusSchema,
  })
  .strict();

export const refundListResponseSchema = z
  .object({ refunds: z.array(refundSummarySchema) })
  .strict();

export type RefundItemRequest = z.infer<typeof refundItemRequestSchema>;
export type CreateRefundRequest = z.infer<typeof createRefundRequestSchema>;
export type CreateOrganizerRefundRequest = z.infer<
  typeof createOrganizerRefundRequestSchema
>;
export type RefundSummary = z.infer<typeof refundSummarySchema>;
export type RefundListResponse = z.infer<typeof refundListResponseSchema>;
