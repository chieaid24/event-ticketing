import { z } from "zod";

export const ticketStatusSchema = z.enum(["active", "void"]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketKindSchema = z.enum(["assigned", "general_admission"]);
export type TicketKind = z.infer<typeof ticketKindSchema>;

/**
 * One admission credential as its owner sees it. Carries the nonsecret public
 * number, event and access details, and rotation state - never a QR hash and
 * never a raw bearer. The raw bearer only ever appears in a reveal response.
 */
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

/**
 * The one-time result of rotating a ticket's QR credential. The raw bearer is
 * returned exactly here and never persisted or logged; a later rotation
 * invalidates it. Clients render it as a QR and must not cache it.
 */
export const qrRevealResponseSchema = z
  .object({
    publicNumber: z.string().min(1).max(20),
    rotatedAt: z.iso.datetime(),
    ticketId: z.uuid(),
    token: z.string().min(1),
  })
  .strict();
export type QrRevealResponse = z.infer<typeof qrRevealResponseSchema>;
