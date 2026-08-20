import {
  createEventRequestSchema,
  cancelEventRequestSchema,
  publishEventRequestSchema,
  replaceTicketTypesRequestSchema,
  updateEventDraftRequestSchema,
  validateEventForPublication,
  type EventDetailResponse,
  type EventListResponse,
  type EventPublicationCheckInput,
  type EventRecord,
  type MembershipRole,
  type OrganizationPermission,
  type SupportedCurrency,
  type TicketType,
  type TicketTypeInput,
  type VenueSectionSummary,
} from "@event-ticketing/contracts";
import type {
  EventRow,
  MembershipRow,
  OrganizationRow,
  TicketTypeInputData,
  TicketTypeRow,
  VenueRow,
  VenueSectionSummaryData,
} from "@event-ticketing/database";

import type { RequestAuthContext } from "../auth/auth.service.js";
import type { SessionAuthenticator } from "../organizations/organizations.service.js";
import { hasPermission } from "../organizations/policy.js";
import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import type { EventsStore } from "./events.store.js";

// publication problems shown per error message
const PUBLISH_ISSUE_LIMIT = 3;

interface ActiveMembership {
  membership: MembershipRow;
  organization: OrganizationRow;
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function toEvent(row: EventRow): EventRecord {
  return {
    createdAt: row.createdAt.toISOString(),
    currency: row.currency as SupportedCurrency,
    customerRefundCutoffMinutes: row.customerRefundCutoffMinutes,
    customerRefundsEnabled: row.customerRefundsEnabled,
    description: row.description,
    endsAt: row.endsAt?.toISOString() ?? null,
    holdDurationSeconds: row.holdDurationSeconds,
    id: row.id,
    inventoryReturnCutoffMinutes: row.inventoryReturnCutoffMinutes,
    mediaUrl: row.mediaUrl,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    refundPolicy: row.refundPolicy,
    salesEndAt: row.salesEndAt?.toISOString() ?? null,
    salesStartAt: row.salesStartAt?.toISOString() ?? null,
    startsAt: row.startsAt?.toISOString() ?? null,
    status: row.status,
    timezone: row.timezone,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    venueId: row.venueId,
    version: row.version,
    waitingRoomEnabled: row.waitingRoomEnabled,
  };
}

function toTicketType(row: TicketTypeRow): TicketType {
  return {
    capacity: row.capacity,
    feeMinor: row.feeMinor,
    id: row.id,
    kind: row.kind,
    name: row.name,
    position: row.position,
    priceMinor: row.priceMinor,
    sectionName: row.sectionName,
  };
}

function toSectionSummary(row: VenueSectionSummaryData): VenueSectionSummary {
  return {
    capacity: row.capacity,
    kind: row.kind,
    name: row.name,
    seatCount: row.seatCount,
  };
}

function toStoredTicketTypes(
  ticketTypes: TicketTypeInput[]
): TicketTypeInputData[] {
  return ticketTypes.map((ticketType) => ({
    capacity:
      ticketType.kind === "general_admission" ? ticketType.capacity : null,
    feeMinor: ticketType.feeMinor,
    kind: ticketType.kind,
    name: ticketType.name,
    priceMinor: ticketType.priceMinor,
    sectionName: ticketType.sectionName,
  }));
}

function toPublicationInput(
  event: EventRow,
  ticketTypes: TicketTypeRow[],
  sections: VenueSectionSummaryData[]
): EventPublicationCheckInput {
  return {
    endsAt: event.endsAt,
    salesEndAt: event.salesEndAt,
    salesStartAt: event.salesStartAt,
    sections: sections.map((section) => ({
      capacity: section.capacity,
      kind: section.kind,
      name: section.name,
      seatCount: section.seatCount,
    })),
    startsAt: event.startsAt,
    ticketTypes: ticketTypes.map((ticketType) => ({
      capacity: ticketType.capacity,
      kind: ticketType.kind,
      name: ticketType.name,
      sectionName: ticketType.sectionName,
    })),
  };
}

export class EventsService {
  constructor(
    private readonly auth: SessionAuthenticator,
    private readonly store: EventsStore
  ) {}

  async listEvents(
    context: RequestAuthContext,
    organizationId: string
  ): Promise<EventListResponse> {
    const { user } = await this.auth.requireSession(context);
    await this.requireActiveMembership(organizationId, user.id);
    const events = await this.store.listEvents(organizationId);
    return {
      events: events.map((row) => ({
        capacity: row.capacity,
        currency: row.currency as SupportedCurrency,
        id: row.id,
        startsAt: row.startsAt?.toISOString() ?? null,
        status: row.status,
        ticketTypeCount: row.ticketTypeCount,
        title: row.title,
        updatedAt: row.updatedAt.toISOString(),
        venueId: row.venueId,
        venueName: row.venueName,
        version: row.version,
      })),
    };
  }

  async getEvent(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string
  ): Promise<EventDetailResponse> {
    const { user } = await this.auth.requireSession(context);
    await this.requireActiveMembership(organizationId, user.id);
    const event = await this.requireEvent(organizationId, eventId);
    return this.buildDetail(organizationId, event);
  }

  async createEvent(
    context: RequestAuthContext,
    organizationId: string,
    input: unknown
  ): Promise<EventDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "events.manage");
    const request = parseRequest(createEventRequestSchema, input);
    await this.requireVenue(organizationId, request.venueId);

    const event = await this.store.createEvent({
      actorUserId: user.id,
      organizationId,
      title: request.title,
      venueId: request.venueId,
    });
    return this.buildDetail(organizationId, event);
  }

  async updateDraft(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string,
    input: unknown
  ): Promise<EventDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "events.manage");
    const request = parseRequest(updateEventDraftRequestSchema, input);
    this.requireDraft(await this.requireEvent(organizationId, eventId));

    const result = await this.store.updateDraft({
      actorUserId: user.id,
      currency: request.currency,
      customerRefundCutoffMinutes: request.customerRefundCutoffMinutes,
      customerRefundsEnabled: request.customerRefundsEnabled,
      description: request.description ?? null,
      endsAt: toDate(request.endsAt),
      eventId,
      expectedVersion: request.version,
      holdDurationSeconds: request.holdDurationSeconds,
      inventoryReturnCutoffMinutes: request.inventoryReturnCutoffMinutes,
      mediaUrl: request.mediaUrl ?? null,
      organizationId,
      refundPolicy: request.refundPolicy ?? null,
      salesEndAt: toDate(request.salesEndAt),
      salesStartAt: toDate(request.salesStartAt),
      startsAt: toDate(request.startsAt),
      timezone: request.timezone,
      title: request.title,
      waitingRoomEnabled: request.waitingRoomEnabled,
    });
    if (result === "version_conflict") {
      this.versionConflict();
    }
    return this.buildDetail(organizationId, result);
  }

  async replaceTicketTypes(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string,
    input: unknown
  ): Promise<EventDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "events.manage");
    const request = parseRequest(replaceTicketTypesRequestSchema, input);
    const event = this.requireDraft(
      await this.requireEvent(organizationId, eventId)
    );

    const sections = await this.store.fetchSectionSummaries(event.venueId);
    this.requireConsistentTicketTypes(request.ticketTypes, sections);

    const result = await this.store.replaceTicketTypes({
      actorUserId: user.id,
      eventId,
      expectedVersion: request.version,
      organizationId,
      ticketTypes: toStoredTicketTypes(request.ticketTypes),
    });
    if (result === "version_conflict") {
      this.versionConflict();
    }
    return this.buildDetail(organizationId, result);
  }

  async publishEvent(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string,
    input: unknown
  ): Promise<EventDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "events.manage");
    const request = parseRequest(publishEventRequestSchema, input);
    const event = this.requireDraft(
      await this.requireEvent(organizationId, eventId)
    );

    const [ticketTypes, sections] = await Promise.all([
      this.store.fetchTicketTypes(eventId),
      this.store.fetchSectionSummaries(event.venueId),
    ]);
    const issues = validateEventForPublication(
      toPublicationInput(event, ticketTypes, sections)
    );
    if (issues.length > 0) {
      const summary = issues.slice(0, PUBLISH_ISSUE_LIMIT).join(" ");
      const remainder = issues.length - PUBLISH_ISSUE_LIMIT;
      apiError(
        422,
        "event_incomplete",
        remainder > 0
          ? `${summary} (${String(remainder)} more problems.)`
          : summary
      );
    }

    const result = await this.store.publishEvent({
      actorUserId: user.id,
      eventId,
      expectedVersion: request.version,
      organizationId,
      venueId: event.venueId,
    });
    if (result === "version_conflict") {
      this.versionConflict();
    }
    return this.buildDetail(organizationId, result);
  }

  async cancelEvent(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string,
    input: unknown
  ): Promise<EventDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "events.manage");
    const request = parseRequest(cancelEventRequestSchema, input);
    const event = await this.requireEvent(organizationId, eventId);
    if (
      event.status !== "published" &&
      event.status !== "sales_paused" &&
      event.status !== "postponed"
    ) {
      apiError(
        409,
        "event_not_cancellable",
        "Only a published, paused, or postponed event can be cancelled."
      );
    }
    const result = await this.store.cancelEvent({
      actorUserId: user.id,
      eventId,
      expectedVersion: request.version,
      organizationId,
      reason: request.reason,
    });
    if (result === "version_conflict") {
      this.versionConflict();
    }
    return this.buildDetail(organizationId, result);
  }

  private async buildDetail(
    organizationId: string,
    event: EventRow
  ): Promise<EventDetailResponse> {
    const [ticketTypes, sections, venue] = await Promise.all([
      this.store.fetchTicketTypes(event.id),
      this.store.fetchSectionSummaries(event.venueId),
      this.store.findVenue({ organizationId, venueId: event.venueId }),
    ]);
    const publishIssues = validateEventForPublication(
      toPublicationInput(event, ticketTypes, sections)
    );
    return {
      availableSections: sections.map(toSectionSummary),
      event: toEvent(event),
      publishIssues,
      ticketTypes: ticketTypes.map(toTicketType),
      venue: { id: event.venueId, name: venue?.name ?? "Unknown venue" },
    };
  }

  // reject ticket types without compatible sections
  private requireConsistentTicketTypes(
    ticketTypes: TicketTypeInput[],
    sections: VenueSectionSummaryData[]
  ): void {
    const byName = new Map(sections.map((section) => [section.name, section]));
    for (const ticketType of ticketTypes) {
      const section = byName.get(ticketType.sectionName);
      if (!section || section.kind !== ticketType.kind) {
        apiError(
          400,
          "ticket_types_invalid",
          `Ticket type "${ticketType.name}" does not match a ` +
            `${ticketType.kind} section in this venue.`
        );
      }
    }
  }

  // hide org existence from non-members
  private async requireActiveMembership(
    organizationId: string,
    userId: string
  ): Promise<ActiveMembership> {
    if (!uuidPattern.test(organizationId)) {
      this.organizationNotFound();
    }
    const organization = await this.store.findOrganization(organizationId);
    const membership = organization
      ? await this.store.findMembership({ organizationId, userId })
      : null;
    if (!organization || !membership || membership.status !== "active") {
      this.organizationNotFound();
    }
    return { membership, organization };
  }

  private async requireEvent(
    organizationId: string,
    eventId: string
  ): Promise<EventRow> {
    if (!uuidPattern.test(eventId)) {
      this.eventNotFound();
    }
    const event = await this.store.findEvent({ eventId, organizationId });
    if (!event) {
      this.eventNotFound();
    }
    return event;
  }

  private async requireVenue(
    organizationId: string,
    venueId: string
  ): Promise<VenueRow> {
    const venue = await this.store.findVenue({ organizationId, venueId });
    if (!venue) {
      apiError(404, "venue_not_found", "The venue does not exist.");
    }
    return venue;
  }

  private requireDraft(event: EventRow): EventRow {
    if (event.status !== "draft") {
      apiError(
        409,
        "event_not_draft",
        "Only a draft event can be edited or published."
      );
    }
    return event;
  }

  private requirePermission(
    role: MembershipRole,
    permission: OrganizationPermission
  ): void {
    if (!hasPermission(role, permission)) {
      apiError(403, "forbidden", "Your role does not allow this action.");
    }
  }

  private organizationNotFound(): never {
    apiError(404, "organization_not_found", "The organization does not exist.");
  }

  private eventNotFound(): never {
    apiError(404, "event_not_found", "The event does not exist.");
  }

  private versionConflict(): never {
    apiError(
      409,
      "version_conflict",
      "The event changed since you loaded it. Reload and retry."
    );
  }
}
