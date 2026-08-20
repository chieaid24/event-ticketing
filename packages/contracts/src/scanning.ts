import { z } from "zod";

export const scanResultSchema = z.enum([
  "accepted",
  "duplicate",
  "wrong_event",
  "refunded",
  "void",
  "expired",
  "invalid",
  "reversed",
]);
export type ScanResult = z.infer<typeof scanResultSchema>;

// check-in records every result except reversal
export const checkInResultSchema = scanResultSchema.exclude(["reversed"]);
export type CheckInResult = z.infer<typeof checkInResultSchema>;

// client device id for rate-limit + attribution; never trusted for authz
export const scanDeviceIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/);

// one credential per attempt; qr bearer is hash-only
export const checkInRequestSchema = z
  .object({
    deviceId: scanDeviceIdSchema,
    publicNumber: z.string().trim().min(4).max(20).optional(),
    qrToken: z.string().min(16).max(512).optional(),
  })
  .strict()
  .refine(
    (request) =>
      (request.qrToken === undefined) !== (request.publicNumber === undefined),
    { message: "Provide exactly one of qrToken or publicNumber." }
  );
export type CheckInRequest = z.infer<typeof checkInRequestSchema>;

// ticket as staff see it; never carries qr material
export const scanTicketDetailSchema = z
  .object({
    checkedInAt: z.iso.datetime().nullable(),
    eventTitle: z.string(),
    publicNumber: z.string().min(1).max(20),
    rowLabel: z.string().nullable(),
    seatLabel: z.string().nullable(),
    sectionName: z.string().nullable(),
    ticketId: z.uuid(),
    ticketTypeName: z.string(),
  })
  .strict();
export type ScanTicketDetail = z.infer<typeof scanTicketDetailSchema>;

export const checkInResponseSchema = z
  .object({
    result: checkInResultSchema,
    scanId: z.uuid(),
    // null exactly when result invalid
    ticket: scanTicketDetailSchema.nullable(),
  })
  .strict();
export type CheckInResponse = z.infer<typeof checkInResponseSchema>;

export const reversalRequestSchema = z
  .object({
    deviceId: scanDeviceIdSchema,
    reason: z.string().trim().min(5).max(500),
    ticketId: z.uuid(),
  })
  .strict();
export type ReversalRequest = z.infer<typeof reversalRequestSchema>;

export const reversalResponseSchema = z
  .object({
    scanId: z.uuid(),
    ticket: scanTicketDetailSchema,
  })
  .strict();
export type ReversalResponse = z.infer<typeof reversalResponseSchema>;

export const scanActivityEntrySchema = z
  .object({
    actorEmail: z.string().nullable(),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    reason: z.string().nullable(),
    result: scanResultSchema,
    ticketId: z.uuid().nullable(),
    ticketPublicNumber: z.string().nullable(),
  })
  .strict();
export type ScanActivityEntry = z.infer<typeof scanActivityEntrySchema>;

// canreverse mirrors scanner.reverse for ui only
export const scanActivityResponseSchema = z
  .object({
    canReverse: z.boolean(),
    scans: z.array(scanActivityEntrySchema),
  })
  .strict();
export type ScanActivityResponse = z.infer<typeof scanActivityResponseSchema>;
