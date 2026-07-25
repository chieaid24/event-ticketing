import { describe, expect, it } from "vitest";

import {
  createVenueRequestSchema,
  MAX_VENUE_SEATS,
  replaceVenueLayoutRequestSchema,
  validateVenueLayout,
  venueLayoutSchema,
  type LayoutRow,
  type VenueLayout,
} from "./venues.js";

function seat(
  label: string,
  x: number,
  overrides: Partial<{
    accessible: boolean;
    companion: boolean;
    y: number;
  }> = {}
) {
  return {
    accessible: overrides.accessible ?? false,
    companion: overrides.companion ?? false,
    label,
    x,
    y: overrides.y ?? 0,
  };
}

function validLayout(): VenueLayout {
  return {
    sections: [
      {
        kind: "assigned",
        name: "Stalls",
        rows: [
          {
            label: "A",
            seats: [
              seat("1", 0),
              seat("2", 1, { accessible: true }),
              seat("3", 2, { companion: true }),
            ],
          },
        ],
      },
      { capacity: 250, kind: "general_admission", name: "Floor" },
    ],
  };
}

describe("venueLayoutSchema", () => {
  it("accepts a valid layout", () => {
    expect(venueLayoutSchema.safeParse(validLayout()).success).toBe(true);
  });

  it("rejects unknown fields at every level", () => {
    const withUnknownSeatField = validLayout();
    const rows = (withUnknownSeatField.sections[0] as { rows: LayoutRow[] })
      .rows;
    (rows[0]?.seats[0] as Record<string, unknown>)["price"] = 100;
    expect(venueLayoutSchema.safeParse(withUnknownSeatField).success).toBe(
      false
    );
    expect(
      venueLayoutSchema.safeParse({ sections: [], theme: "dark" }).success
    ).toBe(false);
  });

  it("rejects a general-admission section with rows", () => {
    const layout = {
      sections: [
        {
          capacity: 10,
          kind: "general_admission",
          name: "Floor",
          rows: [],
        },
      ],
    };
    expect(venueLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it("rejects an assigned section with a capacity", () => {
    const layout = {
      sections: [
        {
          capacity: 10,
          kind: "assigned",
          name: "Stalls",
          rows: [{ label: "A", seats: [seat("1", 0)] }],
        },
      ],
    };
    expect(venueLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it.each([
    ["negative x", seat("1", -1)],
    ["fractional x", seat("1", 1.5)],
    ["x beyond the grid", seat("1", 1001)],
    ["empty label", seat("", 0)],
    ["overlong label", seat("1234567890123", 0)],
    ["unsafe label", seat("<script>", 0)],
  ])("rejects a seat with %s", (_name, badSeat) => {
    const layout = {
      sections: [
        {
          kind: "assigned",
          name: "Stalls",
          rows: [{ label: "A", seats: [badSeat] }],
        },
      ],
    };
    expect(venueLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it("rejects oversized collections", () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      label: `R${String(index)}`,
      seats: [seat("1", 0, { y: index })],
    }));
    const layout = { sections: [{ kind: "assigned", name: "Big", rows }] };
    expect(venueLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it("rejects an unbounded general-admission capacity", () => {
    const layout = {
      sections: [
        { capacity: 100_001, kind: "general_admission", name: "Floor" },
      ],
    };
    expect(venueLayoutSchema.safeParse(layout).success).toBe(false);
  });
});

describe("validateVenueLayout", () => {
  it("accepts a valid layout without issues", () => {
    expect(validateVenueLayout(validLayout())).toEqual([]);
  });

  it("reports duplicate section names case-insensitively", () => {
    const layout: VenueLayout = {
      sections: [
        { capacity: 10, kind: "general_admission", name: "Floor" },
        { capacity: 20, kind: "general_admission", name: "floor" },
      ],
    };
    expect(validateVenueLayout(layout)).toEqual([
      'Section "floor" appears more than once.',
    ]);
  });

  it("reports duplicate row and seat labels", () => {
    const layout: VenueLayout = {
      sections: [
        {
          kind: "assigned",
          name: "Stalls",
          rows: [
            { label: "A", seats: [seat("1", 0), seat("1", 1)] },
            { label: "a", seats: [seat("1", 0, { y: 1 })] },
          ],
        },
      ],
    };
    const issues = validateVenueLayout(layout);
    expect(issues).toContain(
      'Section "Stalls": row "a" appears more than once.'
    );
    expect(issues).toContain(
      'Section "Stalls" row "A": seat "1" appears more than once.'
    );
  });

  it("reports two seats sharing a position in one section", () => {
    const layout: VenueLayout = {
      sections: [
        {
          kind: "assigned",
          name: "Stalls",
          rows: [
            { label: "A", seats: [seat("1", 0)] },
            { label: "B", seats: [seat("1", 0)] },
          ],
        },
      ],
    };
    expect(validateVenueLayout(layout)).toEqual([
      'Section "Stalls": seats "1" and "1" share position (0,0).',
    ]);
  });

  it("rejects a seat that is both accessible and companion", () => {
    const layout: VenueLayout = {
      sections: [
        {
          kind: "assigned",
          name: "Stalls",
          rows: [
            {
              label: "A",
              seats: [seat("1", 0, { accessible: true, companion: true })],
            },
          ],
        },
      ],
    };
    expect(validateVenueLayout(layout)).toEqual([
      'Section "Stalls" row "A": seat "1" cannot be both accessible and ' +
        "companion.",
    ]);
  });

  it("requires a companion seat to sit beside an accessible seat", () => {
    const layout: VenueLayout = {
      sections: [
        {
          kind: "assigned",
          name: "Stalls",
          rows: [
            {
              label: "A",
              seats: [
                seat("1", 0, { accessible: true }),
                seat("2", 2, { companion: true }),
              ],
            },
          ],
        },
      ],
    };
    expect(validateVenueLayout(layout)).toEqual([
      'Section "Stalls" row "A": companion seat "2" has no adjacent ' +
        "accessible seat.",
    ]);
  });

  it("caps the total seat count", () => {
    const bigSection = (name: string, yOffset: number) => ({
      kind: "assigned" as const,
      name,
      rows: Array.from({ length: 100 }, (_, rowIndex) => ({
        label: `R${String(rowIndex)}`,
        seats: Array.from({ length: 100 }, (_, seatIndex) =>
          seat(`S${String(seatIndex)}`, seatIndex, {
            y: yOffset + rowIndex,
          })
        ),
      })),
    });
    const layout: VenueLayout = {
      sections: [bigSection("One", 0), bigSection("Two", 100)],
    };
    expect(validateVenueLayout(layout)).toEqual([
      `The layout has 20000 seats; the maximum is ${String(MAX_VENUE_SEATS)}.`,
    ]);
  });
});

describe("venue request schemas", () => {
  it("trims the venue name", () => {
    const parsed = createVenueRequestSchema.parse({
      name: "  Riverside Hall  ",
    });
    expect(parsed.name).toBe("Riverside Hall");
  });

  it("rejects unknown fields", () => {
    expect(
      createVenueRequestSchema.safeParse({
        name: "Riverside Hall",
        organizationId: "not-allowed",
      }).success
    ).toBe(false);
  });

  it("requires a version on layout replacement", () => {
    expect(
      replaceVenueLayoutRequestSchema.safeParse({
        layout: validLayout(),
      }).success
    ).toBe(false);
    expect(
      replaceVenueLayoutRequestSchema.safeParse({
        layout: validLayout(),
        version: 1,
      }).success
    ).toBe(true);
  });
});
