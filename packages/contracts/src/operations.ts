import { z } from "zod";

const calendarDateSchema = z.iso.date();
const nonNegativeIntegerSchema = z.number().int().min(0);

export const analyticsRangeQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: "custom",
        message: "from must not be after to",
        path: ["from"],
      });
    }
  });

export const financialMetricSchema = z
  .object({
    currency: z.string().length(3),
    feeMinor: nonNegativeIntegerSchema,
    grossMinor: nonNegativeIntegerSchema,
    netMinor: z.number().int(),
    paidOrders: nonNegativeIntegerSchema,
    refundMinor: nonNegativeIntegerSchema,
    ticketsSold: nonNegativeIntegerSchema,
  })
  .strict();

export const dailyFinancialMetricSchema = financialMetricSchema
  .extend({
    date: calendarDateSchema,
    refundCount: nonNegativeIntegerSchema,
  })
  .strict();

export const dailyActivityMetricSchema = z
  .object({
    acceptedCheckins: nonNegativeIntegerSchema,
    checkoutStarted: nonNegativeIntegerSchema,
    date: calendarDateSchema,
    duplicateScans: nonNegativeIntegerSchema,
    holdsCreated: nonNegativeIntegerSchema,
    reversedCheckins: nonNegativeIntegerSchema,
  })
  .strict();

export const organizationAnalyticsResponseSchema = z
  .object({
    checkins: z
      .object({
        accepted: nonNegativeIntegerSchema,
        duplicate: nonNegativeIntegerSchema,
        reversed: nonNegativeIntegerSchema,
      })
      .strict(),
    dailyActivity: z.array(dailyActivityMetricSchema),
    dailyFinancials: z.array(dailyFinancialMetricSchema),
    financials: z.array(financialMetricSchema),
    funnel: z
      .object({
        checkoutStarted: nonNegativeIntegerSchema,
        holdsCreated: nonNegativeIntegerSchema,
        paidOrders: nonNegativeIntegerSchema,
      })
      .strict(),
    generatedAt: z.iso.datetime(),
    inventory: z
      .object({
        available: nonNegativeIntegerSchema,
        blocked: nonNegativeIntegerSchema,
        capacity: nonNegativeIntegerSchema,
        held: nonNegativeIntegerSchema,
        sold: nonNegativeIntegerSchema,
      })
      .strict(),
    range: z
      .object({
        from: calendarDateSchema,
        to: calendarDateSchema,
      })
      .strict(),
    refunds: z
      .object({
        failed: nonNegativeIntegerSchema,
        requested: nonNegativeIntegerSchema,
        succeeded: nonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict();

export const jobStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "dead_letter",
]);

export const operationsJobSchema = z
  .object({
    aggregateId: z.uuid().nullable(),
    aggregateType: z.string().nullable(),
    attemptCount: nonNegativeIntegerSchema,
    availableAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    deadLetteredAt: z.iso.datetime().nullable(),
    id: z.uuid(),
    lastErrorCode: z.string().nullable(),
    maxAttempts: z.number().int().positive(),
    organizationId: z.uuid().nullable(),
    status: jobStatusSchema,
    topic: z.string(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const operationsJobListResponseSchema = z
  .object({
    jobs: z.array(operationsJobSchema),
  })
  .strict();

export const retryJobRequestSchema = z
  .object({
    expectedUpdatedAt: z.iso.datetime(),
  })
  .strict();

export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;
export type OrganizationAnalyticsResponse = z.infer<
  typeof organizationAnalyticsResponseSchema
>;
export type OperationsJob = z.infer<typeof operationsJobSchema>;
export type OperationsJobListResponse = z.infer<
  typeof operationsJobListResponseSchema
>;
export type RetryJobRequest = z.infer<typeof retryJobRequestSchema>;
