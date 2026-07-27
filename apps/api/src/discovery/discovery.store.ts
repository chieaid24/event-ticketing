import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import {
  createDatabasePool,
  fetchAvailabilitySeats,
  fetchGeneralAdmissionCapacity,
  fetchPublicTicketTypes,
  findPublishedEventById,
  listPublishedEvents,
  type AvailabilitySeatRow,
  type GeneralAdmissionCapacityRow,
  type PublicTicketTypeRow,
  type PublishedEventDetailRow,
  type PublishedEventListInput,
  type PublishedEventListResult,
} from "@event-ticketing/database";

export interface EventAvailabilityData {
  generalAdmission: GeneralAdmissionCapacityRow[];
  seats: AvailabilitySeatRow[];
}

export interface DiscoveryStore {
  fetchAvailability(eventId: string): Promise<EventAvailabilityData>;
  fetchTicketTypes(eventId: string): Promise<PublicTicketTypeRow[]>;
  findPublishedEvent(eventId: string): Promise<PublishedEventDetailRow | null>;
  listPublished(
    input: PublishedEventListInput
  ): Promise<PublishedEventListResult>;
}

export class PgDiscoveryStore implements DiscoveryStore, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = createDatabasePool(databaseUrl, { maxConnections: 10 });
  }

  async listPublished(
    input: PublishedEventListInput
  ): Promise<PublishedEventListResult> {
    return listPublishedEvents(this.pool, input);
  }

  async findPublishedEvent(
    eventId: string
  ): Promise<PublishedEventDetailRow | null> {
    return findPublishedEventById(this.pool, eventId);
  }

  async fetchTicketTypes(eventId: string): Promise<PublicTicketTypeRow[]> {
    return fetchPublicTicketTypes(this.pool, eventId);
  }

  async fetchAvailability(eventId: string): Promise<EventAvailabilityData> {
    const [seats, generalAdmission] = await Promise.all([
      fetchAvailabilitySeats(this.pool, eventId),
      fetchGeneralAdmissionCapacity(this.pool, eventId),
    ]);
    return { generalAdmission, seats };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
