import { z } from "zod";

export const statusResponseSchema = z
  .object({
    service: z.literal("api"),
    status: z.literal("available"),
    version: z.literal(1),
  })
  .strict();

export type StatusResponse = z.infer<typeof statusResponseSchema>;
