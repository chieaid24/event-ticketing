import { z } from "zod";

export const waitingRoomTokenSchema = z.string().min(40).max(1_024);

export const waitingRoomQueueResponseSchema = z
  .object({
    eventId: z.uuid(),
    joinedAt: z.iso.datetime(),
    position: z.number().int().min(1),
    queueDepth: z.number().int().min(1),
    queueToken: waitingRoomTokenSchema,
    status: z.literal("queued"),
  })
  .strict();

export const waitingRoomAdmissionResponseSchema = z
  .object({
    admissionExpiresAt: z.iso.datetime(),
    admissionToken: waitingRoomTokenSchema,
    admissionRatePerMinute: z.number().min(0),
    eventId: z.uuid(),
    queueDepth: z.number().int().min(0),
    status: z.literal("admitted"),
    waitMs: z.number().int().min(0),
  })
  .strict();

export const waitingRoomStatusResponseSchema = z.discriminatedUnion("status", [
  waitingRoomQueueResponseSchema,
  waitingRoomAdmissionResponseSchema,
]);

export const waitingRoomHeartbeatResponseSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    status: z.literal("alive"),
  })
  .strict();

export type WaitingRoomQueueResponse = z.infer<
  typeof waitingRoomQueueResponseSchema
>;
export type WaitingRoomAdmissionResponse = z.infer<
  typeof waitingRoomAdmissionResponseSchema
>;
export type WaitingRoomStatusResponse = z.infer<
  typeof waitingRoomStatusResponseSchema
>;
export type WaitingRoomHeartbeatResponse = z.infer<
  typeof waitingRoomHeartbeatResponseSchema
>;
