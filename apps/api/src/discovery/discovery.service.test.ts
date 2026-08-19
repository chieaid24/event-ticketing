import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import {
  eventAvailabilityResponseSchema,
  publicEventDetailResponseSchema,
  publicEventListResponseSchema,
} from "@event-ticketing/contracts";
import type {
  AvailabilitySeatRow,
  GeneralAdmissionCapacityRow,
  PublicTicketTypeRow,
  PublishedEventDetailRow,
  PublishedEventListInput,
  PublishedEventListResult,
  PublishedEventSummaryRow,
} from "@event-ticketing/database";

import { DiscoveryService } from "./discovery.service.js";
import type {
  DiscoveryStore,
  EventAvailabilityData,
} from "./discovery.store.js";

const publishedEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function makeDetailRow(): PublishedEventDetailRow {
  return {
    currency: "USD",
    description: "A synthetic published event.",
    endsAt: new Date("2027-03-01T03:00:00.000Z"),
    id: publishedEventId,
    mediaUrl: null,
    refundPolicy: "Full refund up to 24 hours before.",
    salesEndAt: new Date("2027-03-01T00:00:00.000Z"),
    salesStartAt: new Date("2026-01-02T00:00:00.000Z"),
    startsAt: new Date("2027-03-01T00:00:00.000Z"),
    timezone: "America/Toronto",
    title: "Example Test Gala",
    venueName: "Example Test Hall",
  };
}

function makeSummaryRow(): PublishedEventSummaryRow {
  return {
    currency: "USD",
    endsAt: new Date("2027-03-01T03:00:00.000Z"),
    id: publishedEventId,
    mediaUrl: null,
    minPriceMinor: 1_800,
    salesEndAt: new Date("2027-03-01T00:00:00.000Z"),
    salesStartAt: new Date("2026-01-02T00:00:00.000Z"),
    startsAt: new Date("2027-03-01T00:00:00.000Z"),
    timezone: "America/Toronto",
    title: "Example Test Gala",
    venueName: "Example Test Hall",
  };
}

function makeSeat(
  overrides: Partial<AvailabilitySeatRow>
): AvailabilitySeatRow {
  return {
    accessible: false,
    companion: false,
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    priceMinor: 2_500,
    rowLabel: "A",
    seatLabel: "1",
    sectionName: "Stalls",
    status: "available",
    x: 0,
    y: 0,
    ...overrides,
  };
}

class FakeDiscoveryStore implements DiscoveryStore {
  listInputs: PublishedEventListInput[] = [];
  listResult: PublishedEventListResult = { events: [], total: 0 };
  publishedEvent: PublishedEventDetailRow | null = null;
  ticketTypes: PublicTicketTypeRow[] = [];
  availability: EventAvailabilityData = { generalAdmission: [], seats: [] };

  async listPublished(
    input: PublishedEventListInput
  ): Promise<PublishedEventListResult> {
    this.listInputs.push(input);
    return this.listResult;
  }

  async findPublishedEvent(
    eventId: string
  ): Promise<PublishedEventDetailRow | null> {
    return this.publishedEvent && this.publishedEvent.id === eventId
      ? this.publishedEvent
      : null;
  }

  async fetchTicketTypes(): Promise<PublicTicketTypeRow[]> {
    return this.ticketTypes;
  }

  async fetchAvailability(): Promise<EventAvailabilityData> {
    return this.availability;
  }
}

function makeService(): {
  service: DiscoveryService;
  store: FakeDiscoveryStore;
} {
  const store = new FakeDiscoveryStore();
  return { service: new DiscoveryService(store), store };
}

async function expectHttpError(
  operation: Promise<unknown>,
  status: number,
  code: string
): Promise<void> {
  try {
    await operation;
    expect.unreachable("expected an HttpException");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toMatchObject({ code });
  }
}

describe("DiscoveryService.listEvents", () => {
  it("returns a contract-valid listing with pagination", async () => {
    const { service, store } = makeService();
    store.listResult = { events: [makeSummaryRow()], total: 1 };

    const response = await service.listEvents({ search: " gala " });

    expect(publicEventListResponseSchema.parse(response)).toEqual(response);
    expect(response.events[0]?.title).toBe("Example Test Gala");
    expect(response.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
    expect(store.listInputs).toEqual([
      { limit: 20, offset: 0, search: "gala", timeframe: "upcoming" },
    ]);
  });

  it("drops an empty search before it reaches the store", async () => {
    const { service, store } = makeService();
    await service.listEvents({ search: "   " });
    expect(store.listInputs[0]?.search).toBeUndefined();
  });

  it("rejects a limit above the cap", async () => {
    const { service } = makeService();
    await expectHttpError(
      service.listEvents({ limit: "51" }),
      400,
      "invalid_request"
    );
  });

  it("rejects unknown query fields", async () => {
    const { service } = makeService();
    await expectHttpError(
      service.listEvents({ status: "draft" }),
      400,
      "invalid_request"
    );
  });
});

describe("DiscoveryService.getEvent", () => {
  it("returns only public fields for a published event", async () => {
    const { service, store } = makeService();
    store.publishedEvent = makeDetailRow();
    store.ticketTypes = [
      {
        feeMinor: 250,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        kind: "assigned",
        name: "Stalls Reserved",
        priceMinor: 2_500,
        sectionName: "Stalls",
      },
    ];

    const response = await service.getEvent(publishedEventId);

    expect(publicEventDetailResponseSchema.parse(response)).toEqual(response);
    expect(response.venue).toEqual({ name: "Example Test Hall" });
    expect(response.ticketTypes).toHaveLength(1);
    expect(response.event).not.toHaveProperty("version");
    expect(response.event).not.toHaveProperty("holdDurationSeconds");
  });

  it("returns 404 for an unpublished or unknown event", async () => {
    const { service } = makeService();
    await expectHttpError(
      service.getEvent(publishedEventId),
      404,
      "event_not_found"
    );
  });

  it("returns the same 404 for a malformed id", async () => {
    const { service } = makeService();
    await expectHttpError(
      service.getEvent("not-a-uuid"),
      404,
      "event_not_found"
    );
  });
});

describe("DiscoveryService.getAvailability", () => {
  it("maps sold and held seats to unavailable and groups sections", async () => {
    const { service, store } = makeService();
    store.publishedEvent = makeDetailRow();
    store.availability = {
      generalAdmission: [],
      seats: [
        makeSeat({}),
        makeSeat({
          id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
          seatLabel: "2",
          status: "sold",
          x: 1,
        }),
        makeSeat({
          id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
          rowLabel: "C",
          sectionName: "Balcony",
          status: "held",
        }),
      ],
    };

    const response = await service.getAvailability(publishedEventId);

    expect(eventAvailabilityResponseSchema.parse(response)).toEqual(response);
    expect(response.sections.map((section) => section.name)).toEqual([
      "Stalls",
      "Balcony",
    ]);
    const statuses = response.sections[0]?.seats.map((seat) => seat.status);
    expect(statuses).toEqual(["available", "unavailable"]);
    expect(response.sections[1]?.seats[0]?.status).toBe("unavailable");
  });

  it("reports coarse general-admission levels", async () => {
    const { service, store } = makeService();
    store.publishedEvent = makeDetailRow();
    const generalAdmission: GeneralAdmissionCapacityRow[] = [
      {
        capacity: 200,
        feeMinor: 150,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        name: "Standing Floor",
        priceMinor: 1_800,
        remaining: 150,
      },
      {
        capacity: 200,
        feeMinor: 150,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
        name: "Nearly Held Floor",
        priceMinor: 1_800,
        remaining: 12,
      },
      {
        capacity: 100,
        feeMinor: 0,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
        name: "Fully Held Floor",
        priceMinor: 1_000,
        remaining: 0,
      },
    ];
    store.availability = { generalAdmission, seats: [] };

    const response = await service.getAvailability(publishedEventId);

    expect(eventAvailabilityResponseSchema.parse(response)).toEqual(response);
    expect(
      response.generalAdmission.map((ticketType) => ticketType.level)
    ).toEqual(["available", "limited", "sold_out"]);
  });

  it("returns 404 before exposing availability of an unpublished event", async () => {
    const { service } = makeService();
    await expectHttpError(
      service.getAvailability(publishedEventId),
      404,
      "event_not_found"
    );
  });
});
