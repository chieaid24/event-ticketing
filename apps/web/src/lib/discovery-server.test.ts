import { describe, expect, it, vi } from "vitest";

import { fetchPublicEventDetail, fetchPublicEvents } from "./discovery-server";

const listPayload = {
  events: [
    {
      currency: "USD",
      endsAt: "2027-03-01T03:00:00.000Z",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      mediaUrl: null,
      minPriceMinor: 1800,
      salesEndAt: "2027-03-01T00:00:00.000Z",
      salesStartAt: "2026-01-02T00:00:00.000Z",
      startsAt: "2027-03-01T00:00:00.000Z",
      timezone: "America/Toronto",
      title: "Example Test Gala",
      venueName: "Example Test Hall",
    },
  ],
  pagination: { limit: 20, offset: 0, total: 1 },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("fetchPublicEvents", () => {
  it("passes query parameters and parses the response", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(listPayload));

    const result = await fetchPublicEvents(
      "https://api.example.test",
      { offset: 20, search: "gala", timeframe: "all" },
      request
    );

    expect(result).toEqual({ data: listPayload, kind: "ok" });
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/discovery/events?search=gala&timeframe=all&offset=20"
    );
  });

  it("reports an error for a response with unexpected fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...listPayload,
        events: [{ ...listPayload.events[0], version: 4 }],
      })
    );

    await expect(
      fetchPublicEvents("https://api.example.test", {}, request)
    ).resolves.toEqual({ kind: "error" });
  });

  it("reports an error when the API is unreachable", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));

    await expect(
      fetchPublicEvents("https://api.example.test", {}, request)
    ).resolves.toEqual({ kind: "error" });
  });
});

describe("fetchPublicEventDetail", () => {
  const detailPayload = {
    event: {
      currency: "USD",
      description: null,
      endsAt: "2027-03-01T03:00:00.000Z",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      mediaUrl: null,
      refundPolicy: null,
      salesEndAt: "2027-03-01T00:00:00.000Z",
      salesStartAt: "2026-01-02T00:00:00.000Z",
      startsAt: "2027-03-01T00:00:00.000Z",
      timezone: "America/Toronto",
      title: "Example Test Gala",
    },
    ticketTypes: [],
    venue: { name: "Example Test Hall" },
  };

  it("parses a published event detail", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(detailPayload));

    await expect(
      fetchPublicEventDetail(
        "https://api.example.test",
        detailPayload.event.id,
        request
      )
    ).resolves.toEqual({ data: detailPayload, kind: "ok" });
  });

  it("distinguishes a missing event from a failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: "event_not_found" }, 404));

    await expect(
      fetchPublicEventDetail(
        "https://api.example.test",
        detailPayload.event.id,
        request
      )
    ).resolves.toEqual({ kind: "not_found" });
  });
});
