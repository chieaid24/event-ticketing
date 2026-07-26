import { z } from "zod";

export const MAX_EVENT_TITLE = 140;
export const MAX_EVENT_DESCRIPTION = 2_000;
export const MAX_REFUND_POLICY = 2_000;
export const MAX_MEDIA_URL = 2_048;
export const MAX_TICKET_TYPES = 50;
export const MAX_TICKET_TYPE_NAME = 80;
/** One million major units in minor units; a generous per-ticket ceiling. */
export const MAX_MONEY_MINOR = 100_000_000;
export const MAX_GA_CAPACITY = 100_000;
export const MIN_HOLD_SECONDS = 60;
export const MAX_HOLD_SECONDS = 86_400;

/** Currencies the platform sells in. Multi-currency remains deferred scope. */
export const supportedCurrencies = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;

export const eventStatusSchema = z.enum([
  "draft",
  "published",
  "sales_paused",
  "postponed",
  "cancelled",
  "completed",
  "archived",
]);

export const eventTitleSchema = z.string().trim().min(3).max(MAX_EVENT_TITLE);
export const eventDescriptionSchema = z
  .string()
  .trim()
  .max(MAX_EVENT_DESCRIPTION);
export const refundPolicySchema = z.string().trim().max(MAX_REFUND_POLICY);
export const mediaUrlSchema = z.url().max(MAX_MEDIA_URL);
export const currencySchema = z.enum(supportedCurrencies);
export const moneyMinorSchema = z.number().int().min(0).max(MAX_MONEY_MINOR);
export const holdDurationSchema = z
  .number()
  .int()
  .min(MIN_HOLD_SECONDS)
  .max(MAX_HOLD_SECONDS);

/**
 * An IANA time zone the host runtime recognizes. `Intl.DateTimeFormat` throws a
 * `RangeError` for unknown zones, which keeps this canonical-list agnostic.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unknown IANA time zone." });

const ticketTypeNameSchema = z.string().trim().min(1).max(MAX_TICKET_TYPE_NAME);
const sectionNameSchema = z.string().trim().min(1).max(80);

export const assignedTicketTypeSchema = z
  .object({
    feeMinor: moneyMinorSchema,
    kind: z.literal("assigned"),
    name: ticketTypeNameSchema,
    priceMinor: moneyMinorSchema,
    sectionName: sectionNameSchema,
  })
  .strict();

export const generalAdmissionTicketTypeSchema = z
  .object({
    capacity: z.number().int().min(1).max(MAX_GA_CAPACITY),
    feeMinor: moneyMinorSchema,
    kind: z.literal("general_admission"),
    name: ticketTypeNameSchema,
    priceMinor: moneyMinorSchema,
    sectionName: sectionNameSchema,
  })
  .strict();

export const ticketTypeInputSchema = z.discriminatedUnion("kind", [
  assignedTicketTypeSchema,
  generalAdmissionTicketTypeSchema,
]);

export const createEventRequestSchema = z
  .object({
    title: eventTitleSchema,
    venueId: z.uuid(),
  })
  .strict();

export const updateEventDraftRequestSchema = z
  .object({
    currency: currencySchema,
    description: eventDescriptionSchema.nullish(),
    endsAt: z.iso.datetime().nullish(),
    holdDurationSeconds: holdDurationSchema,
    mediaUrl: mediaUrlSchema.nullish(),
    refundPolicy: refundPolicySchema.nullish(),
    salesEndAt: z.iso.datetime().nullish(),
    salesStartAt: z.iso.datetime().nullish(),
    startsAt: z.iso.datetime().nullish(),
    timezone: timeZoneSchema,
    title: eventTitleSchema,
    version: z.number().int().min(1),
  })
  .strict();

export const replaceTicketTypesRequestSchema = z
  .object({
    ticketTypes: z.array(ticketTypeInputSchema).max(MAX_TICKET_TYPES),
    version: z.number().int().min(1),
  })
  .strict();

export const publishEventRequestSchema = z
  .object({
    version: z.number().int().min(1),
  })
  .strict();

export const ticketTypeSchema = z
  .object({
    capacity: z.number().int().nullable(),
    feeMinor: z.number().int().min(0),
    id: z.uuid(),
    kind: z.enum(["assigned", "general_admission"]),
    name: z.string(),
    position: z.number().int().min(0),
    priceMinor: z.number().int().min(0),
    sectionName: z.string(),
  })
  .strict();

export const eventSchema = z
  .object({
    createdAt: z.iso.datetime(),
    currency: currencySchema,
    description: z.string().nullable(),
    endsAt: z.iso.datetime().nullable(),
    holdDurationSeconds: z.number().int(),
    id: z.uuid(),
    mediaUrl: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    refundPolicy: z.string().nullable(),
    salesEndAt: z.iso.datetime().nullable(),
    salesStartAt: z.iso.datetime().nullable(),
    startsAt: z.iso.datetime().nullable(),
    status: eventStatusSchema,
    timezone: z.string(),
    title: z.string(),
    updatedAt: z.iso.datetime(),
    venueId: z.uuid(),
    version: z.number().int(),
  })
  .strict();

export const eventSummarySchema = z
  .object({
    capacity: z.number().int().min(0),
    currency: currencySchema,
    id: z.uuid(),
    startsAt: z.iso.datetime().nullable(),
    status: eventStatusSchema,
    ticketTypeCount: z.number().int().min(0),
    title: z.string(),
    updatedAt: z.iso.datetime(),
    venueId: z.uuid(),
    venueName: z.string(),
    version: z.number().int(),
  })
  .strict();

export const venueSectionSummarySchema = z
  .object({
    capacity: z.number().int().min(0),
    kind: z.enum(["assigned", "general_admission"]),
    name: z.string(),
    seatCount: z.number().int().min(0),
  })
  .strict();

export const eventListResponseSchema = z
  .object({
    events: z.array(eventSummarySchema),
  })
  .strict();

export const eventDetailResponseSchema = z
  .object({
    availableSections: z.array(venueSectionSummarySchema),
    event: eventSchema,
    publishIssues: z.array(z.string()),
    ticketTypes: z.array(ticketTypeSchema),
    venue: z.object({ id: z.uuid(), name: z.string() }).strict(),
  })
  .strict();

export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;
export type UpdateEventDraftRequest = z.infer<
  typeof updateEventDraftRequestSchema
>;
export type ReplaceTicketTypesRequest = z.infer<
  typeof replaceTicketTypesRequestSchema
>;
export type PublishEventRequest = z.infer<typeof publishEventRequestSchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type SupportedCurrency = z.infer<typeof currencySchema>;
export type TicketType = z.infer<typeof ticketTypeSchema>;
export type EventRecord = z.infer<typeof eventSchema>;
export type EventSummary = z.infer<typeof eventSummarySchema>;
export type VenueSectionSummary = z.infer<typeof venueSectionSummarySchema>;
export type EventListResponse = z.infer<typeof eventListResponseSchema>;
export type EventDetailResponse = z.infer<typeof eventDetailResponseSchema>;

export interface EventPublicationCheckInput {
  endsAt: Date | null;
  salesEndAt: Date | null;
  salesStartAt: Date | null;
  sections: {
    capacity: number;
    kind: "assigned" | "general_admission";
    name: string;
    seatCount: number;
  }[];
  startsAt: Date | null;
  ticketTypes: {
    capacity: number | null;
    kind: "assigned" | "general_admission";
    name: string;
    sectionName: string;
  }[];
}

/**
 * Every rule the structural schema cannot enforce, evaluated server-side before
 * publication. Returns all violations so an organizer sees one complete review
 * summary rather than fixing errors one at a time.
 */
export function validateEventForPublication(
  input: EventPublicationCheckInput
): string[] {
  const issues: string[] = [];

  if (!input.startsAt) {
    issues.push("Set the event start time.");
  }
  if (!input.endsAt) {
    issues.push("Set the event end time.");
  }
  if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
    issues.push("The event must end after it starts.");
  }

  if (!input.salesStartAt) {
    issues.push("Set when ticket sales open.");
  }
  if (!input.salesEndAt) {
    issues.push("Set when ticket sales close.");
  }
  if (
    input.salesStartAt &&
    input.salesEndAt &&
    input.salesStartAt >= input.salesEndAt
  ) {
    issues.push("Sales must close after they open.");
  }
  if (input.salesEndAt && input.endsAt && input.salesEndAt > input.endsAt) {
    issues.push("Sales cannot close after the event ends.");
  }

  if (input.ticketTypes.length === 0) {
    issues.push("Add at least one ticket type.");
  }

  const sectionsByName = new Map(
    input.sections.map((section) => [section.name, section])
  );
  const ticketTypeNames = new Set<string>();
  let sellableUnits = 0;

  for (const ticketType of input.ticketTypes) {
    const nameKey = ticketType.name.toLowerCase();
    if (ticketTypeNames.has(nameKey)) {
      issues.push(`Ticket type "${ticketType.name}" appears more than once.`);
    }
    ticketTypeNames.add(nameKey);

    const section = sectionsByName.get(ticketType.sectionName);
    if (!section) {
      issues.push(
        `Ticket type "${ticketType.name}" maps to section ` +
          `"${ticketType.sectionName}", which the venue no longer has.`
      );
      continue;
    }
    if (section.kind !== ticketType.kind) {
      issues.push(
        `Ticket type "${ticketType.name}" is ${ticketType.kind} but section ` +
          `"${ticketType.sectionName}" is ${section.kind}.`
      );
      continue;
    }

    if (ticketType.kind === "assigned") {
      if (section.seatCount === 0) {
        issues.push(
          `Section "${ticketType.sectionName}" has no seats to sell.`
        );
      }
      sellableUnits += section.seatCount;
    } else {
      const capacity = ticketType.capacity ?? 0;
      if (capacity <= 0) {
        issues.push(
          `Ticket type "${ticketType.name}" needs a positive capacity.`
        );
      } else if (capacity > section.capacity) {
        issues.push(
          `Ticket type "${ticketType.name}" capacity exceeds section ` +
            `"${ticketType.sectionName}" capacity of ${String(
              section.capacity
            )}.`
        );
      }
      sellableUnits += capacity;
    }
  }

  if (input.ticketTypes.length > 0 && sellableUnits === 0) {
    issues.push("The event has no sellable inventory.");
  }
  return issues;
}
