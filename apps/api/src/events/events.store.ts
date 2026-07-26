import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  claimEventVersion,
  createDatabasePool,
  enqueueOutboxEvent,
  fetchSectionSeats,
  fetchTicketTypes,
  fetchVenueSectionSummaries,
  findEventById,
  findMembershipByUser,
  findOrganizationById,
  findVenueById,
  insertAuditLog,
  insertEvent,
  insertEventSeats,
  listEventsForOrganization,
  markEventPublished,
  replaceTicketTypes,
  updateEventDraft,
  withDatabaseTransaction,
  type EventRow,
  type EventSummaryRow,
  type MembershipRow,
  type OrganizationRow,
  type TicketTypeInputData,
  type TicketTypeRow,
  type UpdateEventDraftInput,
  type VenueRow,
  type VenueSectionSummaryData,
} from "@event-ticketing/database";

/** Outbox topic for a published event; consumers materialize discovery. */
export const EVENT_PUBLISHED_TOPIC = "event.published";

export type UpdateDraftResult = EventRow | "version_conflict";
export type ReplaceTicketTypesResult = EventRow | "version_conflict";
export type PublishResult = EventRow | "version_conflict";

export interface EventsStore {
  createEvent(input: {
    actorUserId: string;
    organizationId: string;
    title: string;
    venueId: string;
  }): Promise<EventRow>;
  fetchSectionSummaries(venueId: string): Promise<VenueSectionSummaryData[]>;
  fetchTicketTypes(eventId: string): Promise<TicketTypeRow[]>;
  findEvent(input: {
    eventId: string;
    organizationId: string;
  }): Promise<EventRow | null>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null>;
  findOrganization(organizationId: string): Promise<OrganizationRow | null>;
  findVenue(input: {
    organizationId: string;
    venueId: string;
  }): Promise<VenueRow | null>;
  listEvents(organizationId: string): Promise<EventSummaryRow[]>;
  publishEvent(input: {
    actorUserId: string;
    eventId: string;
    expectedVersion: number;
    organizationId: string;
    venueId: string;
  }): Promise<PublishResult>;
  replaceTicketTypes(input: {
    actorUserId: string;
    eventId: string;
    expectedVersion: number;
    organizationId: string;
    ticketTypes: TicketTypeInputData[];
  }): Promise<ReplaceTicketTypesResult>;
  updateDraft(
    input: UpdateEventDraftInput & { actorUserId: string }
  ): Promise<UpdateDraftResult>;
}

export class PgEventsStore implements EventsStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async findOrganization(
    organizationId: string
  ): Promise<OrganizationRow | null> {
    return findOrganizationById(this.pool, organizationId);
  }

  async findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipRow | null> {
    return findMembershipByUser(this.pool, input);
  }

  async findVenue(input: {
    organizationId: string;
    venueId: string;
  }): Promise<VenueRow | null> {
    return findVenueById(this.pool, input);
  }

  async findEvent(input: {
    eventId: string;
    organizationId: string;
  }): Promise<EventRow | null> {
    return findEventById(this.pool, input);
  }

  async listEvents(organizationId: string): Promise<EventSummaryRow[]> {
    return listEventsForOrganization(this.pool, organizationId);
  }

  async fetchTicketTypes(eventId: string): Promise<TicketTypeRow[]> {
    return fetchTicketTypes(this.pool, eventId);
  }

  async fetchSectionSummaries(
    venueId: string
  ): Promise<VenueSectionSummaryData[]> {
    return fetchVenueSectionSummaries(this.pool, venueId);
  }

  async createEvent(input: {
    actorUserId: string;
    organizationId: string;
    title: string;
    venueId: string;
  }): Promise<EventRow> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const event = await insertEvent(tx, {
        organizationId: input.organizationId,
        title: input.title,
        venueId: input.venueId,
      });
      await insertAuditLog(tx, {
        action: "event.created",
        actorUserId: input.actorUserId,
        detail: { title: event.title, venueId: event.venueId },
        organizationId: input.organizationId,
        targetId: event.id,
        targetType: "event",
      });
      return event;
    });
  }

  async updateDraft(
    input: UpdateEventDraftInput & { actorUserId: string }
  ): Promise<UpdateDraftResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const updated = await updateEventDraft(tx, input);
      if (!updated) {
        return "version_conflict";
      }
      await insertAuditLog(tx, {
        action: "event.updated",
        actorUserId: input.actorUserId,
        detail: { title: updated.title, version: updated.version },
        organizationId: input.organizationId,
        targetId: updated.id,
        targetType: "event",
      });
      return updated;
    });
  }

  async replaceTicketTypes(input: {
    actorUserId: string;
    eventId: string;
    expectedVersion: number;
    organizationId: string;
    ticketTypes: TicketTypeInputData[];
  }): Promise<ReplaceTicketTypesResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      // The CAS bump also locks the event row, serializing draft writes.
      const event = await claimEventVersion(tx, {
        eventId: input.eventId,
        expectedVersion: input.expectedVersion,
        organizationId: input.organizationId,
      });
      if (!event) {
        return "version_conflict";
      }
      await replaceTicketTypes(tx, {
        eventId: input.eventId,
        ticketTypes: input.ticketTypes,
      });
      await insertAuditLog(tx, {
        action: "event.ticket_types.replaced",
        actorUserId: input.actorUserId,
        detail: {
          ticketTypeCount: input.ticketTypes.length,
          version: event.version,
        },
        organizationId: input.organizationId,
        targetId: input.eventId,
        targetType: "event",
      });
      return event;
    });
  }

  async publishEvent(input: {
    actorUserId: string;
    eventId: string;
    expectedVersion: number;
    organizationId: string;
    venueId: string;
  }): Promise<PublishResult> {
    return withDatabaseTransaction(this.pool, async (tx) => {
      const claimed = await claimEventVersion(tx, {
        eventId: input.eventId,
        expectedVersion: input.expectedVersion,
        organizationId: input.organizationId,
      });
      if (!claimed) {
        return "version_conflict";
      }

      const ticketTypes = await fetchTicketTypes(tx, input.eventId);
      let seatCount = 0;
      for (const ticketType of ticketTypes) {
        if (ticketType.kind !== "assigned") {
          continue;
        }
        const seats = await fetchSectionSeats(tx, {
          sectionName: ticketType.sectionName,
          venueId: input.venueId,
        });
        await insertEventSeats(tx, {
          eventId: input.eventId,
          priceMinor: ticketType.priceMinor,
          sectionName: ticketType.sectionName,
          seats,
          ticketTypeId: ticketType.id,
        });
        seatCount += seats.length;
      }

      await insertAuditLog(tx, {
        action: "event.published",
        actorUserId: input.actorUserId,
        detail: { seatCount, ticketTypeCount: ticketTypes.length },
        organizationId: input.organizationId,
        targetId: input.eventId,
        targetType: "event",
      });
      await enqueueOutboxEvent(tx, {
        aggregateId: input.eventId,
        aggregateType: "event",
        deduplicationKey: `${EVENT_PUBLISHED_TOPIC}:${input.eventId}`,
        payload: {
          eventId: input.eventId,
          organizationId: input.organizationId,
          seatCount,
          ticketTypeCount: ticketTypes.length,
        },
        topic: EVENT_PUBLISHED_TOPIC,
      });

      const published = await markEventPublished(tx, {
        eventId: input.eventId,
        organizationId: input.organizationId,
      });
      // The claim already proved the event was a draft inside this transaction.
      return published ?? "version_conflict";
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
