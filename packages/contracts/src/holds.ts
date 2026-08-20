import { z } from "zod";

import { currencySchema, moneyMinorSchema } from "./events.js";

export const MAX_SEATS_PER_HOLD = 10;
export const MAX_IDEMPOTENCY_KEY = 200;

export const holdStatusSchema = z.enum([
  "active",
  "checkout_started",
  "consumed",
  "expired",
  "cancelled",
]);
export type HoldStatus = z.infer<typeof holdStatusSchema>;

// idempotency-key header, scoped per actor server-side
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_IDEMPOTENCY_KEY);

export const createAssignedSeatHoldRequestSchema = z
  .object({
    eventId: z.uuid(),
    seatIds: z.array(z.uuid()).min(1).max(MAX_SEATS_PER_HOLD),
  })
  .strict();
export type CreateAssignedSeatHoldRequest = z.infer<
  typeof createAssignedSeatHoldRequestSchema
>;

export const assignedSeatHoldItemSchema = z
  .object({
    eventSeatId: z.uuid(),
    rowLabel: z.string(),
    seatLabel: z.string(),
    sectionName: z.string(),
    ticketTypeId: z.uuid(),
    unitFeeMinor: moneyMinorSchema,
    unitPriceMinor: moneyMinorSchema,
  })
  .strict();
export type AssignedSeatHoldItem = z.infer<typeof assignedSeatHoldItemSchema>;

export const createAssignedSeatHoldResponseSchema = z
  .object({
    currency: currencySchema,
    eventId: z.uuid(),
    expiresAt: z.iso.datetime(),
    feeMinor: moneyMinorSchema,
    holdId: z.uuid(),
    seats: z.array(assignedSeatHoldItemSchema),
    status: holdStatusSchema,
    subtotalMinor: moneyMinorSchema,
    totalMinor: moneyMinorSchema,
  })
  .strict();
export type CreateAssignedSeatHoldResponse = z.infer<
  typeof createAssignedSeatHoldResponseSchema
>;

// conflict body: only unavailable seat ids, never another customers hold
export const seatsUnavailableResponseSchema = z
  .object({
    code: z.literal("seats_unavailable"),
    message: z.string(),
    seatIds: z.array(z.uuid()),
  })
  .strict();
export type SeatsUnavailableResponse = z.infer<
  typeof seatsUnavailableResponseSchema
>;
