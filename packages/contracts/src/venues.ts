import { z } from "zod";

export const MAX_VENUE_SEATS = 10_000;
export const MAX_SEAT_COORDINATE = 1_000;

export const venueNameSchema = z.string().trim().min(3).max(120);

export const venueDescriptionSchema = z.string().trim().max(400);

export const venueSectionKindSchema = z.enum(["assigned", "general_admission"]);

const sectionNameSchema = z.string().trim().min(1).max(80);

const layoutLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/);

const coordinateSchema = z.number().int().min(0).max(MAX_SEAT_COORDINATE);

export const layoutSeatSchema = z
  .object({
    accessible: z.boolean(),
    companion: z.boolean(),
    label: layoutLabelSchema,
    x: coordinateSchema,
    y: coordinateSchema,
  })
  .strict();

export const layoutRowSchema = z
  .object({
    label: layoutLabelSchema,
    seats: z.array(layoutSeatSchema).min(1).max(100),
  })
  .strict();

export const assignedSectionSchema = z
  .object({
    kind: z.literal("assigned"),
    name: sectionNameSchema,
    rows: z.array(layoutRowSchema).min(1).max(100),
  })
  .strict();

export const generalAdmissionSectionSchema = z
  .object({
    capacity: z.number().int().min(1).max(100_000),
    kind: z.literal("general_admission"),
    name: sectionNameSchema,
  })
  .strict();

export const layoutSectionSchema = z.discriminatedUnion("kind", [
  assignedSectionSchema,
  generalAdmissionSectionSchema,
]);

export const venueLayoutSchema = z
  .object({
    sections: z.array(layoutSectionSchema).max(50),
  })
  .strict();

export type LayoutSeat = z.infer<typeof layoutSeatSchema>;
export type LayoutRow = z.infer<typeof layoutRowSchema>;
export type AssignedSection = z.infer<typeof assignedSectionSchema>;
export type GeneralAdmissionSection = z.infer<
  typeof generalAdmissionSectionSchema
>;
export type LayoutSection = z.infer<typeof layoutSectionSchema>;
export type VenueLayout = z.infer<typeof venueLayoutSchema>;

/**
 * Cross-field rules the structural schema cannot express. Returns every
 * violation so organizers see one complete validation summary.
 */
export function validateVenueLayout(layout: VenueLayout): string[] {
  const issues: string[] = [];
  const sectionNames = new Set<string>();
  let totalSeats = 0;

  for (const section of layout.sections) {
    const sectionKey = section.name.toLowerCase();
    if (sectionNames.has(sectionKey)) {
      issues.push(`Section "${section.name}" appears more than once.`);
    }
    sectionNames.add(sectionKey);
    if (section.kind !== "assigned") {
      continue;
    }

    const rowLabels = new Set<string>();
    const positions = new Map<string, string>();
    for (const row of section.rows) {
      const rowKey = row.label.toLowerCase();
      if (rowLabels.has(rowKey)) {
        issues.push(
          `Section "${section.name}": row "${row.label}" appears more than once.`
        );
      }
      rowLabels.add(rowKey);

      const seatLabels = new Set<string>();
      for (const seat of row.seats) {
        totalSeats += 1;
        const seatKey = seat.label.toLowerCase();
        if (seatLabels.has(seatKey)) {
          issues.push(
            `Section "${section.name}" row "${row.label}": seat ` +
              `"${seat.label}" appears more than once.`
          );
        }
        seatLabels.add(seatKey);

        const position = `${String(seat.x)},${String(seat.y)}`;
        const occupant = positions.get(position);
        if (occupant) {
          issues.push(
            `Section "${section.name}": seats "${occupant}" and ` +
              `"${seat.label}" share position (${position}).`
          );
        } else {
          positions.set(position, seat.label);
        }

        if (seat.accessible && seat.companion) {
          issues.push(
            `Section "${section.name}" row "${row.label}": seat ` +
              `"${seat.label}" cannot be both accessible and companion.`
          );
        } else if (seat.companion && !hasAdjacentAccessibleSeat(row, seat)) {
          issues.push(
            `Section "${section.name}" row "${row.label}": companion seat ` +
              `"${seat.label}" has no adjacent accessible seat.`
          );
        }
      }
    }
  }

  if (totalSeats > MAX_VENUE_SEATS) {
    issues.push(
      `The layout has ${String(totalSeats)} seats; the maximum is ` +
        `${String(MAX_VENUE_SEATS)}.`
    );
  }
  return issues;
}

/** A companion seat must sit directly beside an accessible seat in its row. */
function hasAdjacentAccessibleSeat(row: LayoutRow, seat: LayoutSeat): boolean {
  return row.seats.some(
    (candidate) =>
      candidate.accessible &&
      candidate.y === seat.y &&
      Math.abs(candidate.x - seat.x) === 1
  );
}

export const createVenueRequestSchema = z
  .object({
    description: venueDescriptionSchema.optional(),
    name: venueNameSchema,
  })
  .strict();

export const updateVenueRequestSchema = z
  .object({
    description: venueDescriptionSchema.optional(),
    name: venueNameSchema,
    version: z.number().int().min(1),
  })
  .strict();

export const replaceVenueLayoutRequestSchema = z
  .object({
    layout: venueLayoutSchema,
    version: z.number().int().min(1),
  })
  .strict();

export const venueSchema = z
  .object({
    createdAt: z.iso.datetime(),
    description: z.string().nullable(),
    id: z.uuid(),
    name: z.string(),
    updatedAt: z.iso.datetime(),
    version: z.number().int(),
  })
  .strict();

export const venueSummarySchema = z
  .object({
    accessibleSeatCount: z.number().int().min(0),
    description: z.string().nullable(),
    generalAdmissionCapacity: z.number().int().min(0),
    id: z.uuid(),
    name: z.string(),
    seatCount: z.number().int().min(0),
    sectionCount: z.number().int().min(0),
    updatedAt: z.iso.datetime(),
    version: z.number().int(),
  })
  .strict();

export const venueListResponseSchema = z
  .object({
    venues: z.array(venueSummarySchema),
  })
  .strict();

export const venueDetailResponseSchema = z
  .object({
    layout: venueLayoutSchema,
    venue: venueSchema,
  })
  .strict();

export type CreateVenueRequest = z.infer<typeof createVenueRequestSchema>;
export type UpdateVenueRequest = z.infer<typeof updateVenueRequestSchema>;
export type ReplaceVenueLayoutRequest = z.infer<
  typeof replaceVenueLayoutRequestSchema
>;
export type Venue = z.infer<typeof venueSchema>;
export type VenueSummary = z.infer<typeof venueSummarySchema>;
export type VenueListResponse = z.infer<typeof venueListResponseSchema>;
export type VenueDetailResponse = z.infer<typeof venueDetailResponseSchema>;
export type VenueSectionKind = z.infer<typeof venueSectionKindSchema>;
