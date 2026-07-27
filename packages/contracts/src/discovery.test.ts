import { describe, expect, it } from "vitest";

import {
  DISCOVERY_DEFAULT_LIMIT,
  eventAvailabilityResponseSchema,
  generalAdmissionLevel,
  publicEventDetailSchema,
  publicEventListQuerySchema,
  publicEventSummarySchema,
} from "./discovery.js";

describe("publicEventListQuerySchema", () => {
  it("applies defaults when the query is empty", () => {
    const parsed = publicEventListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      limit: DISCOVERY_DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it("coerces string query values", () => {
    const parsed = publicEventListQuerySchema.safeParse({
      limit: "5",
      offset: "10",
      search: "  gala  ",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ limit: 5, offset: 10, search: "gala" });
  });

  it("rejects a limit above the cap", () => {
    const parsed = publicEventListQuerySchema.safeParse({ limit: "51" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a negative offset", () => {
    const parsed = publicEventListQuerySchema.safeParse({ offset: "-1" });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown query fields", () => {
    const parsed = publicEventListQuerySchema.safeParse({ status: "draft" });
    expect(parsed.success).toBe(false);
  });
});

const summary = {
  currency: "USD",
  endsAt: "2026-09-01T02:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  mediaUrl: null,
  minPriceMinor: 2_500,
  salesEndAt: "2026-08-31T22:00:00.000Z",
  salesStartAt: "2026-08-01T00:00:00.000Z",
  startsAt: "2026-09-01T00:00:00.000Z",
  timezone: "America/Toronto",
  title: "Autumn Gala",
  venueName: "Example Test Hall",
};

describe("publicEventSummarySchema", () => {
  it("accepts a published summary", () => {
    expect(publicEventSummarySchema.safeParse(summary).success).toBe(true);
  });

  it.each(["status", "version", "holdDurationSeconds", "organizationId"])(
    "rejects the internal field %s",
    (field) => {
      const parsed = publicEventSummarySchema.safeParse({
        ...summary,
        [field]: 1,
      });
      expect(parsed.success).toBe(false);
    }
  );

  it("rejects a null start time", () => {
    const parsed = publicEventSummarySchema.safeParse({
      ...summary,
      startsAt: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("publicEventDetailSchema", () => {
  it("carries description and refund policy but no listing aggregates", () => {
    const { minPriceMinor: _price, venueName: _venue, ...rest } = summary;
    const parsed = publicEventDetailSchema.safeParse({
      ...rest,
      description: "An evening of music.",
      refundPolicy: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("eventAvailabilityResponseSchema", () => {
  const availability = {
    eventId: "11111111-1111-4111-8111-111111111111",
    generalAdmission: [
      {
        feeMinor: 150,
        level: "available",
        name: "Standing Floor",
        priceMinor: 1_800,
        ticketTypeId: "22222222-2222-4222-8222-222222222222",
      },
    ],
    generatedAt: "2026-07-26T12:00:00.000Z",
    sections: [
      {
        name: "Stalls",
        seats: [
          {
            accessible: false,
            companion: false,
            id: "33333333-3333-4333-8333-333333333333",
            priceMinor: 2_500,
            rowLabel: "A",
            seatLabel: "1",
            status: "available",
            x: 0,
            y: 0,
          },
        ],
      },
    ],
  };

  it("accepts advisory availability", () => {
    const parsed = eventAvailabilityResponseSchema.safeParse(availability);
    expect(parsed.success).toBe(true);
  });

  it("rejects internal seat states such as held", () => {
    const parsed = eventAvailabilityResponseSchema.safeParse({
      ...availability,
      sections: [
        {
          name: "Stalls",
          seats: [{ ...availability.sections[0]!.seats[0]!, status: "held" }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects hold-ownership metadata on seats", () => {
    const parsed = eventAvailabilityResponseSchema.safeParse({
      ...availability,
      sections: [
        {
          name: "Stalls",
          seats: [
            {
              ...availability.sections[0]!.seats[0]!,
              holdId: "44444444-4444-4444-8444-444444444444",
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("generalAdmissionLevel", () => {
  it("reports sold out at zero remaining", () => {
    expect(generalAdmissionLevel(0, 100)).toBe("sold_out");
  });

  it("reports limited at ten percent of capacity", () => {
    expect(generalAdmissionLevel(10, 100)).toBe("limited");
  });

  it("reports limited at one remaining regardless of capacity", () => {
    expect(generalAdmissionLevel(1, 5)).toBe("limited");
  });

  it("reports available above the limited threshold", () => {
    expect(generalAdmissionLevel(11, 100)).toBe("available");
  });
});
