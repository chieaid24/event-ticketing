import {
  createVenueRequestSchema,
  replaceVenueLayoutRequestSchema,
  updateVenueRequestSchema,
  validateVenueLayout,
  type AcceptedResponse,
  type MembershipRole,
  type OrganizationPermission,
  type Venue,
  type VenueDetailResponse,
  type VenueLayout,
  type VenueListResponse,
} from "@event-ticketing/contracts";
import type {
  MembershipRow,
  OrganizationRow,
  VenueLayoutSectionData,
  VenueRow,
} from "@event-ticketing/database";

import type { RequestAuthContext } from "../auth/auth.service.js";
import type { SessionAuthenticator } from "../organizations/organizations.service.js";
import { hasPermission } from "../organizations/policy.js";
import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import type { VenuesStore } from "./venues.store.js";

// layout problems shown per error message
const LAYOUT_ISSUE_LIMIT = 3;

interface ActiveMembership {
  membership: MembershipRow;
  organization: OrganizationRow;
}

function toVenue(row: VenueRow): Venue {
  return {
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function toStoredSections(layout: VenueLayout): VenueLayoutSectionData[] {
  return layout.sections.map((section) =>
    section.kind === "assigned"
      ? {
          gaCapacity: null,
          kind: section.kind,
          name: section.name,
          rows: section.rows,
        }
      : {
          gaCapacity: section.capacity,
          kind: section.kind,
          name: section.name,
          rows: [],
        }
  );
}

function toLayout(sections: VenueLayoutSectionData[]): VenueLayout {
  return {
    sections: sections.map((section) =>
      section.kind === "assigned"
        ? { kind: "assigned", name: section.name, rows: section.rows }
        : {
            capacity: section.gaCapacity ?? 0,
            kind: "general_admission",
            name: section.name,
          }
    ),
  };
}

export class VenuesService {
  constructor(
    private readonly auth: SessionAuthenticator,
    private readonly store: VenuesStore
  ) {}

  async listVenues(
    context: RequestAuthContext,
    organizationId: string
  ): Promise<VenueListResponse> {
    const { user } = await this.auth.requireSession(context);
    await this.requireActiveMembership(organizationId, user.id);
    const venues = await this.store.listVenues(organizationId);
    return {
      venues: venues.map((row) => ({
        accessibleSeatCount: row.accessibleSeatCount,
        description: row.description,
        generalAdmissionCapacity: row.generalAdmissionCapacity,
        id: row.id,
        name: row.name,
        seatCount: row.seatCount,
        sectionCount: row.sectionCount,
        updatedAt: row.updatedAt.toISOString(),
        version: row.version,
      })),
    };
  }

  async getVenue(
    context: RequestAuthContext,
    organizationId: string,
    venueId: string
  ): Promise<VenueDetailResponse> {
    const { user } = await this.auth.requireSession(context);
    await this.requireActiveMembership(organizationId, user.id);
    const venue = await this.requireVenue(organizationId, venueId);
    const sections = await this.store.fetchLayout(venue.id);
    return { layout: toLayout(sections), venue: toVenue(venue) };
  }

  async createVenue(
    context: RequestAuthContext,
    organizationId: string,
    input: unknown
  ): Promise<VenueDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "venues.manage");
    const request = parseRequest(createVenueRequestSchema, input);

    const result = await this.store.createVenue({
      actorUserId: user.id,
      description: request.description ?? null,
      name: request.name,
      organizationId,
    });
    if (result === "name_taken") {
      this.nameTaken();
    }
    return { layout: { sections: [] }, venue: toVenue(result) };
  }

  async updateVenue(
    context: RequestAuthContext,
    organizationId: string,
    venueId: string,
    input: unknown
  ): Promise<VenueDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "venues.manage");
    const request = parseRequest(updateVenueRequestSchema, input);
    await this.requireVenue(organizationId, venueId);

    const result = await this.store.updateVenue({
      actorUserId: user.id,
      description: request.description ?? null,
      expectedVersion: request.version,
      name: request.name,
      organizationId,
      venueId,
    });
    if (result === "version_conflict") {
      this.versionConflict();
    }
    if (result === "name_taken") {
      this.nameTaken();
    }
    const sections = await this.store.fetchLayout(venueId);
    return { layout: toLayout(sections), venue: toVenue(result) };
  }

  async replaceLayout(
    context: RequestAuthContext,
    organizationId: string,
    venueId: string,
    input: unknown
  ): Promise<VenueDetailResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "venues.manage");
    const request = parseRequest(replaceVenueLayoutRequestSchema, input);
    const issues = validateVenueLayout(request.layout);
    if (issues.length > 0) {
      const summary = issues.slice(0, LAYOUT_ISSUE_LIMIT).join(" ");
      const remainder = issues.length - LAYOUT_ISSUE_LIMIT;
      apiError(
        400,
        "layout_invalid",
        remainder > 0
          ? `${summary} (${String(remainder)} more problems.)`
          : summary
      );
    }
    await this.requireVenue(organizationId, venueId);

    const result = await this.store.replaceLayout({
      actorUserId: user.id,
      expectedVersion: request.version,
      organizationId,
      sections: toStoredSections(request.layout),
      venueId,
    });
    if (result === "version_conflict") {
      this.versionConflict();
    }
    return { layout: request.layout, venue: toVenue(result) };
  }

  async deleteVenue(
    context: RequestAuthContext,
    organizationId: string,
    venueId: string
  ): Promise<AcceptedResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "venues.manage");
    await this.requireVenue(organizationId, venueId);

    const deleted = await this.store.deleteVenue({
      actorUserId: user.id,
      organizationId,
      venueId,
    });
    if (!deleted) {
      this.venueNotFound();
    }
    return { status: "accepted" };
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

  private async requireVenue(
    organizationId: string,
    venueId: string
  ): Promise<VenueRow> {
    if (!uuidPattern.test(venueId)) {
      this.venueNotFound();
    }
    const venue = await this.store.findVenue({ organizationId, venueId });
    if (!venue) {
      this.venueNotFound();
    }
    return venue;
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

  private venueNotFound(): never {
    apiError(404, "venue_not_found", "The venue does not exist.");
  }

  private nameTaken(): never {
    apiError(
      409,
      "venue_name_taken",
      "The organization already has a venue with that name."
    );
  }

  private versionConflict(): never {
    apiError(
      409,
      "version_conflict",
      "The venue changed since you loaded it. Reload and retry."
    );
  }
}
