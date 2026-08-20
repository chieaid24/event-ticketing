import { z } from "zod";

export const ticketStatusSchema = z.enum([
  "active",
  "checked_in",
  "void",
  "refunded",
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketKindSchema = z.enum(["assigned", "general_admission"]);
export type TicketKind = z.infer<typeof ticketKindSchema>;

// owner-visible ticket; public number + details, never qr hash or raw bearer
export const ticketSummarySchema = z
  .object({
    eventEndsAt: z.iso.datetime().nullable(),
    eventId: z.uuid(),
    eventStartsAt: z.iso.datetime().nullable(),
    eventStatus: z.string(),
    eventTimezone: z.string(),
    eventTitle: z.string(),
    id: z.uuid(),
    orderId: z.uuid(),
    orderPublicNumber: z.string().min(1).max(20),
    publicNumber: z.string().min(1).max(20),
    qrRotatedAt: z.iso.datetime().nullable(),
    rowLabel: z.string().nullable(),
    seatAccessible: z.boolean().nullable(),
    seatLabel: z.string().nullable(),
    sectionName: z.string().nullable(),
    status: ticketStatusSchema,
    ticketTypeKind: ticketKindSchema,
    ticketTypeName: z.string(),
    venueDescription: z.string().nullable(),
    venueName: z.string(),
  })
  .strict();
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const ticketListResponseSchema = z
  .object({ tickets: z.array(ticketSummarySchema) })
  .strict();
export type TicketListResponse = z.infer<typeof ticketListResponseSchema>;

// one-time qr rotation result; raw bearer only here, never persisted, dont cache
export const qrRevealResponseSchema = z
  .object({
    publicNumber: z.string().min(1).max(20),
    rotatedAt: z.iso.datetime(),
    ticketId: z.uuid(),
    token: z.string().min(1),
  })
  .strict();
export type QrRevealResponse = z.infer<typeof qrRevealResponseSchema>;
