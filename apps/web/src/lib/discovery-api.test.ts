import { describe, expect, it, vi } from "vitest";

import { DiscoveryApiError, fetchEventAvailability } from "./discovery-api";

const availabilityPayload = {
  eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  generalAdmission: [
    {
      feeMinor: 150,
      level: "available",
      name: "Standing Floor",
      priceMinor: 1800,
      ticketTypeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
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
          id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
          priceMinor: 2500,
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

describe("fetchEventAvailability", () => {
  it("returns contract-valid availability", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(availabilityPayload), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    await expect(
      fetchEventAvailability(
        "https://api.example.test",
        availabilityPayload.eventId,
        request
      )
    ).resolves.toEqual(availabilityPayload);
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/discovery/events/" +
        `${availabilityPayload.eventId}/availability`
    );
  });

  it("rejects a response carrying hold ownership metadata", async () => {
    const leaky = structuredClone(availabilityPayload) as Record<
      string,
      unknown
    >;
    (
      (leaky["sections"] as { seats: Record<string, unknown>[] }[])[0]!
        .seats[0] as Record<string, unknown>
    )["holdOwner"] = "someone";
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(leaky), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    await expect(
      fetchEventAvailability(
        "https://api.example.test",
        availabilityPayload.eventId,
        request
      )
    ).rejects.toBeInstanceOf(DiscoveryApiError);
  });

  it("rejects transport failures", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));

    await expect(
      fetchEventAvailability(
        "https://api.example.test",
        availabilityPayload.eventId,
        request
      )
    ).rejects.toBeInstanceOf(DiscoveryApiError);
  });
});
