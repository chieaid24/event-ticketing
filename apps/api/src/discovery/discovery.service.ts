import {
  generalAdmissionLevel,
  publicEventListQuerySchema,
  type EventAvailabilityResponse,
  type PublicEventDetailResponse,
  type PublicEventListResponse,
  type PublicEventSummary,
  type PublicSeatSection,
  type SupportedCurrency,
} from "@event-ticketing/contracts";
import type {
  AvailabilitySeatRow,
  PublishedEventDetailRow,
  PublishedEventSummaryRow,
} from "@event-ticketing/database";

import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import type { DiscoveryStore } from "./discovery.store.js";

function toSummary(row: PublishedEventSummaryRow): PublicEventSummary {
  return {
    currency: row.currency as SupportedCurrency,
    endsAt: row.endsAt.toISOString(),
    id: row.id,
    mediaUrl: row.mediaUrl,
    minPriceMinor: row.minPriceMinor,
    salesEndAt: row.salesEndAt.toISOString(),
    salesStartAt: row.salesStartAt.toISOString(),
    startsAt: row.startsAt.toISOString(),
    timezone: row.timezone,
    title: row.title,
    venueName: row.venueName,
  };
}

function toDetailResponse(
  row: PublishedEventDetailRow,
  ticketTypes: PublicEventDetailResponse["ticketTypes"]
): PublicEventDetailResponse {
  return {
    event: {
      currency: row.currency as SupportedCurrency,
      description: row.description,
      endsAt: row.endsAt.toISOString(),
      id: row.id,
      mediaUrl: row.mediaUrl,
      refundPolicy: row.refundPolicy,
      salesEndAt: row.salesEndAt.toISOString(),
      salesStartAt: row.salesStartAt.toISOString(),
      startsAt: row.startsAt.toISOString(),
      timezone: row.timezone,
      title: row.title,
    },
    ticketTypes,
    venue: { name: row.venueName },
  };
}

// held and sold seats both read unavailable
function toSeatSections(seats: AvailabilitySeatRow[]): PublicSeatSection[] {
  const sections = new Map<string, PublicSeatSection>();
  for (const seat of seats) {
    let section = sections.get(seat.sectionName);
    if (!section) {
      section = { name: seat.sectionName, seats: [] };
      sections.set(seat.sectionName, section);
    }
    section.seats.push({
      accessible: seat.accessible,
      companion: seat.companion,
      id: seat.id,
      priceMinor: seat.priceMinor,
      rowLabel: seat.rowLabel,
      seatLabel: seat.seatLabel,
      status: seat.status === "available" ? "available" : "unavailable",
      x: seat.x,
      y: seat.y,
    });
  }
  return [...sections.values()];
}

export class DiscoveryService {
  constructor(private readonly store: DiscoveryStore) {}

  async listEvents(query: unknown): Promise<PublicEventListResponse> {
    const request = parseRequest(publicEventListQuerySchema, query);
    const result = await this.store.listPublished({
      limit: request.limit,
      offset: request.offset,
      search: request.search || undefined,
      timeframe: request.timeframe,
    });
    return {
      events: result.events.map(toSummary),
      pagination: {
        limit: request.limit,
        offset: request.offset,
        total: result.total,
      },
    };
  }

  async getEvent(eventId: string): Promise<PublicEventDetailResponse> {
    const event = await this.requirePublishedEvent(eventId);
    const ticketTypes = await this.store.fetchTicketTypes(event.id);
    return toDetailResponse(
      event,
      ticketTypes.map((ticketType) => ({
        feeMinor: ticketType.feeMinor,
        id: ticketType.id,
        kind: ticketType.kind,
        name: ticketType.name,
        priceMinor: ticketType.priceMinor,
        sectionName: ticketType.sectionName,
      }))
    );
  }

  async getAvailability(eventId: string): Promise<EventAvailabilityResponse> {
    const event = await this.requirePublishedEvent(eventId);
    const { generalAdmission, seats } = await this.store.fetchAvailability(
      event.id
    );
    return {
      eventId: event.id,
      generalAdmission: generalAdmission.map((ticketType) => ({
        feeMinor: ticketType.feeMinor,
        level: generalAdmissionLevel(ticketType.remaining, ticketType.capacity),
        name: ticketType.name,
        priceMinor: ticketType.priceMinor,
        ticketTypeId: ticketType.id,
      })),
      generatedAt: new Date().toISOString(),
      sections: toSeatSections(seats),
    };
  }

  // hide draft and malformed ids behind the same 404
  private async requirePublishedEvent(
    eventId: string
  ): Promise<PublishedEventDetailRow> {
    if (!uuidPattern.test(eventId)) {
      this.eventNotFound();
    }
    const event = await this.store.findPublishedEvent(eventId);
    if (!event) {
      this.eventNotFound();
    }
    return event;
  }

  private eventNotFound(): never {
    apiError(404, "event_not_found", "The event does not exist.");
  }
}
