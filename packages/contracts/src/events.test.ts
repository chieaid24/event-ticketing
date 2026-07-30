import { describe, expect, it } from "vitest";

import {
  createEventRequestSchema,
  isValidTimeZone,
  publishEventRequestSchema,
  replaceTicketTypesRequestSchema,
  ticketTypeInputSchema,
  updateEventDraftRequestSchema,
  validateEventForPublication,
  type EventPublicationCheckInput,
} from "./events.js";

describe("isValidTimeZone", () => {
  it.each(["UTC", "America/Toronto", "Europe/London"])("accepts %s", (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each(["", "Mars/Phobos", "Not A Zone"])("rejects %s", (zone) => {
    expect(isValidTimeZone(zone)).toBe(false);
  });
});

describe("createEventRequestSchema", () => {
  it("accepts a title and venue id", () => {
    const parsed = createEventRequestSchema.safeParse({
      title: "Autumn Gala",
      venueId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a short title", () => {
    const parsed = createEventRequestSchema.safeParse({
      title: "no",
      venueId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const parsed = createEventRequestSchema.safeParse({
      slug: "x",
      title: "Autumn Gala",
      venueId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("updateEventDraftRequestSchema", () => {
  const base = {
    currency: "USD",
    customerRefundCutoffMinutes: 1440,
    customerRefundsEnabled: false,
    holdDurationSeconds: 600,
    inventoryReturnCutoffMinutes: 1440,
    timezone: "America/Toronto",
    title: "Autumn Gala",
    version: 1,
    waitingRoomEnabled: false,
  };

  it("accepts a minimal draft with null schedule fields", () => {
    const parsed = updateEventDraftRequestSchema.safeParse({
      ...base,
      endsAt: null,
      startsAt: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a fully specified draft", () => {
    const parsed = updateEventDraftRequestSchema.safeParse({
      ...base,
      description: "An evening of music.",
      endsAt: "2026-09-01T02:00:00.000Z",
      mediaUrl: "https://cdn.example.test/poster.jpg",
      refundPolicy: "Full refund up to 24 hours before.",
      salesEndAt: "2026-08-31T22:00:00.000Z",
      salesStartAt: "2026-08-01T00:00:00.000Z",
      startsAt: "2026-09-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown IANA time zone", () => {
    const parsed = updateEventDraftRequestSchema.safeParse({
      ...base,
      timezone: "Mars/Phobos",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unsupported currency", () => {
    const parsed = updateEventDraftRequestSchema.safeParse({
      ...base,
      currency: "XYZ",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a hold duration below the floor", () => {
    const parsed = updateEventDraftRequestSchema.safeParse({
      ...base,
      holdDurationSeconds: 5,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ticketTypeInputSchema", () => {
  it("accepts an assigned ticket type without capacity", () => {
    const parsed = ticketTypeInputSchema.safeParse({
      feeMinor: 250,
      kind: "assigned",
      name: "Orchestra",
      priceMinor: 8_000,
      sectionName: "Stalls",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires capacity on general admission", () => {
    const parsed = ticketTypeInputSchema.safeParse({
      feeMinor: 0,
      kind: "general_admission",
      name: "Lawn",
      priceMinor: 3_000,
      sectionName: "Field",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a negative price", () => {
    const parsed = ticketTypeInputSchema.safeParse({
      feeMinor: 0,
      kind: "assigned",
      name: "Orchestra",
      priceMinor: -1,
      sectionName: "Stalls",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("replaceTicketTypesRequestSchema and publishEventRequestSchema", () => {
  it("accepts an empty ticket-type list with a version", () => {
    const parsed = replaceTicketTypesRequestSchema.safeParse({
      ticketTypes: [],
      version: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a positive version to publish", () => {
    expect(publishEventRequestSchema.safeParse({ version: 0 }).success).toBe(
      false
    );
    expect(publishEventRequestSchema.safeParse({ version: 1 }).success).toBe(
      true
    );
  });
});

describe("validateEventForPublication", () => {
  function validInput(): EventPublicationCheckInput {
    return {
      endsAt: new Date("2026-09-01T02:00:00.000Z"),
      salesEndAt: new Date("2026-08-31T22:00:00.000Z"),
      salesStartAt: new Date("2026-08-01T00:00:00.000Z"),
      sections: [
        { capacity: 0, kind: "assigned", name: "Stalls", seatCount: 40 },
        {
          capacity: 200,
          kind: "general_admission",
          name: "Lawn",
          seatCount: 0,
        },
      ],
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      ticketTypes: [
        {
          capacity: null,
          kind: "assigned",
          name: "Seated",
          sectionName: "Stalls",
        },
        {
          capacity: 150,
          kind: "general_admission",
          name: "Lawn",
          sectionName: "Lawn",
        },
      ],
    };
  }

  it("returns no issues for a complete, consistent event", () => {
    expect(validateEventForPublication(validInput())).toEqual([]);
  });

  it("flags a missing schedule", () => {
    const issues = validateEventForPublication({
      ...validInput(),
      endsAt: null,
      startsAt: null,
    });
    expect(issues).toContain("Set the event start time.");
    expect(issues).toContain("Set the event end time.");
  });

  it("flags an inverted schedule and sales window", () => {
    const input = validInput();
    const issues = validateEventForPublication({
      ...input,
      salesEndAt: new Date("2026-07-01T00:00:00.000Z"),
      startsAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(issues).toContain("The event must end after it starts.");
    expect(issues).toContain("Sales must close after they open.");
  });

  it("flags sales closing after the event ends", () => {
    const input = validInput();
    const issues = validateEventForPublication({
      ...input,
      salesEndAt: new Date("2026-09-01T03:00:00.000Z"),
    });
    expect(issues).toContain("Sales cannot close after the event ends.");
  });

  it("requires at least one ticket type", () => {
    const issues = validateEventForPublication({
      ...validInput(),
      ticketTypes: [],
    });
    expect(issues).toContain("Add at least one ticket type.");
  });

  it("flags a ticket type mapped to a missing section", () => {
    const input = validInput();
    const issues = validateEventForPublication({
      ...input,
      ticketTypes: [
        {
          capacity: null,
          kind: "assigned",
          name: "Seated",
          sectionName: "Gone",
        },
      ],
    });
    expect(
      issues.some((issue) => issue.includes("the venue no longer has"))
    ).toBe(true);
  });

  it("flags a kind mismatch between ticket type and section", () => {
    const input = validInput();
    const issues = validateEventForPublication({
      ...input,
      ticketTypes: [
        {
          capacity: 10,
          kind: "general_admission",
          name: "Wrong",
          sectionName: "Stalls",
        },
      ],
    });
    expect(issues.some((issue) => issue.includes("is general_admission"))).toBe(
      true
    );
  });

  it("flags general-admission capacity above the section capacity", () => {
    const input = validInput();
    const issues = validateEventForPublication({
      ...input,
      ticketTypes: [
        {
          capacity: 500,
          kind: "general_admission",
          name: "Lawn",
          sectionName: "Lawn",
        },
      ],
    });
    expect(issues.some((issue) => issue.includes("exceeds section"))).toBe(
      true
    );
  });

  it("flags a duplicate ticket-type name", () => {
    const input = validInput();
    const issues = validateEventForPublication({
      ...input,
      ticketTypes: [
        {
          capacity: null,
          kind: "assigned",
          name: "Seated",
          sectionName: "Stalls",
        },
        {
          capacity: null,
          kind: "assigned",
          name: "seated",
          sectionName: "Stalls",
        },
      ],
    });
    expect(
      issues.some((issue) => issue.includes("appears more than once"))
    ).toBe(true);
  });
});
