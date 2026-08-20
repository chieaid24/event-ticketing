import { describe, expect, it } from "vitest";

import { formatEventInstant, formatMoney } from "./format";

describe("formatMoney", () => {
  it("renders integer minor units in the sale currency", () => {
    expect(formatMoney(3000, "USD")).toBe("US$30.00");
  });

  it("keeps two fraction digits for whole amounts", () => {
    expect(formatMoney(0, "USD")).toBe("US$0.00");
  });
});

describe("formatEventInstant", () => {
  it("renders the instant in the event time zone, not the viewer's", () => {
    // 01:00 utc sep 1 is prev evening in toronto (utc-4)
    const formatted = formatEventInstant(
      "2026-09-01T01:00:00.000Z",
      "America/Toronto"
    );
    expect(formatted).toContain("31 Aug 2026");
    expect(formatted).toContain("21:00");
    expect(formatted).toMatch(/GMT-4|EDT/);
  });

  it("does not throw when pairing a zone label with date and time parts", () => {
    // guards illegal datestyle/timestyle + timezonename combo
    expect(() =>
      formatEventInstant("2026-01-15T12:00:00.000Z", "UTC")
    ).not.toThrow();
  });
});
