import { z } from "zod";

import { currencySchema } from "./events.js";

export const MAX_DISCOVERY_SEARCH = 100;
export const DISCOVERY_DEFAULT_LIMIT = 20;
export const DISCOVERY_MAX_LIMIT = 50;
export const DISCOVERY_MAX_OFFSET = 10_000;
// remaining capacity share at/below which admission reads limited
export const GA_LIMITED_FRACTION = 0.1;

// coarse ga level hides sales volume
export function generalAdmissionLevel(
  remaining: number,
  capacity: number
): GeneralAdmissionLevel {
  if (remaining <= 0) {
    return "sold_out";
  }
  if (remaining <= Math.max(1, capacity * GA_LIMITED_FRACTION)) {
    return "limited";
  }
  return "available";
}

export const publicEventListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(DISCOVERY_MAX_LIMIT)
      .default(DISCOVERY_DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).max(DISCOVERY_MAX_OFFSET).default(0),
    search: z.string().trim().max(MAX_DISCOVERY_SEARCH).optional(),
    timeframe: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  })
  .strict();

export type DiscoveryTimeframe = z.infer<
  typeof publicEventListQuerySchema
>["timeframe"];

// public slice hides organizer fields; timestamps required
export const publicEventSummarySchema = z
  .object({
    currency: currencySchema,
    endsAt: z.iso.datetime(),
    id: z.uuid(),
    mediaUrl: z.string().nullable(),
    minPriceMinor: z.number().int().min(0),
    salesEndAt: z.iso.datetime(),
    salesStartAt: z.iso.datetime(),
    startsAt: z.iso.datetime(),
    timezone: z.string(),
    title: z.string(),
    venueName: z.string(),
  })
  .strict();

export const publicEventListResponseSchema = z
  .object({
    events: z.array(publicEventSummarySchema),
    pagination: z
      .object({
        limit: z.number().int().min(1),
        offset: z.number().int().min(0),
        total: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export const publicTicketTypeSchema = z
  .object({
    feeMinor: z.number().int().min(0),
    id: z.uuid(),
    kind: z.enum(["assigned", "general_admission"]),
    name: z.string(),
    priceMinor: z.number().int().min(0),
    sectionName: z.string(),
  })
  .strict();

export const publicEventDetailSchema = publicEventSummarySchema
  .omit({ minPriceMinor: true, venueName: true })
  .extend({
    description: z.string().nullable(),
    refundPolicy: z.string().nullable(),
  })
  .strict();

export const publicEventDetailResponseSchema = z
  .object({
    event: publicEventDetailSchema,
    ticketTypes: z.array(publicTicketTypeSchema),
    venue: z.object({ name: z.string() }).strict(),
  })
  .strict();

// held and sold both read unavailable; difference is internal
export const publicSeatStatusSchema = z.enum(["available", "unavailable"]);

export const publicSeatSchema = z
  .object({
    accessible: z.boolean(),
    companion: z.boolean(),
    id: z.uuid(),
    priceMinor: z.number().int().min(0),
    rowLabel: z.string(),
    seatLabel: z.string(),
    status: publicSeatStatusSchema,
    x: z.number().int(),
    y: z.number().int(),
  })
  .strict();

export const publicSeatSectionSchema = z
  .object({
    name: z.string(),
    seats: z.array(publicSeatSchema),
  })
  .strict();

export const generalAdmissionLevelSchema = z.enum([
  "available",
  "limited",
  "sold_out",
]);

export const publicGeneralAdmissionSchema = z
  .object({
    feeMinor: z.number().int().min(0),
    level: generalAdmissionLevelSchema,
    name: z.string(),
    priceMinor: z.number().int().min(0),
    ticketTypeId: z.uuid(),
  })
  .strict();

export const eventAvailabilityResponseSchema = z
  .object({
    eventId: z.uuid(),
    generalAdmission: z.array(publicGeneralAdmissionSchema),
    generatedAt: z.iso.datetime(),
    sections: z.array(publicSeatSectionSchema),
  })
  .strict();

export type PublicEventListQuery = z.infer<typeof publicEventListQuerySchema>;
export type PublicEventSummary = z.infer<typeof publicEventSummarySchema>;
export type PublicEventListResponse = z.infer<
  typeof publicEventListResponseSchema
>;
export type PublicTicketType = z.infer<typeof publicTicketTypeSchema>;
export type PublicEventDetail = z.infer<typeof publicEventDetailSchema>;
export type PublicEventDetailResponse = z.infer<
  typeof publicEventDetailResponseSchema
>;
export type PublicSeatStatus = z.infer<typeof publicSeatStatusSchema>;
export type PublicSeat = z.infer<typeof publicSeatSchema>;
export type PublicSeatSection = z.infer<typeof publicSeatSectionSchema>;
export type GeneralAdmissionLevel = z.infer<typeof generalAdmissionLevelSchema>;
export type PublicGeneralAdmission = z.infer<
  typeof publicGeneralAdmissionSchema
>;
export type EventAvailabilityResponse = z.infer<
  typeof eventAvailabilityResponseSchema
>;
