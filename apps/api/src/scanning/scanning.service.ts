import {
  checkInRequestSchema,
  reversalRequestSchema,
  type CheckInResponse,
  type MembershipRole,
  type OrganizationPermission,
  type ReversalResponse,
  type ScanActivityResponse,
  type ScanTicketDetail,
} from "@event-ticketing/contracts";
import {
  hashQrToken,
  type MembershipRow,
  type OrganizationRow,
  type ScanCredential,
  type ScanTicketDetail as ScanTicketDetailRow,
} from "@event-ticketing/database";

import type { RequestAuthContext } from "../auth/auth.service.js";
import type { RateLimiter } from "../auth/rate-limiter.js";
import type { SessionAuthenticator } from "../organizations/organizations.service.js";
import { hasPermission } from "../organizations/policy.js";
import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import type { ScanningStore } from "./scanning.store.js";

/** How many recent scans one activity read returns. */
const ACTIVITY_LIMIT = 20;

/**
 * Scan-flow abuse limits. The per-device and per-actor windows bound a stolen
 * credential or misbehaving device without blocking a venue full of scanners
 * that share one network address.
 */
const DEVICE_SCAN_LIMIT = { max: 60, windowMs: 60 * 1000 };
const ACTOR_SCAN_LIMIT = { max: 120, windowMs: 60 * 1000 };
const ACTOR_REVERSAL_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };

interface ActiveMembership {
  membership: MembershipRow;
  organization: OrganizationRow;
}

export class ScanningService {
  constructor(
    private readonly auth: SessionAuthenticator,
    private readonly store: ScanningStore,
    private readonly rateLimiter: RateLimiter
  ) {}

  /**
   * Validates one presented credential and checks the ticket in when it is
   * eligible. The raw QR bearer is hashed here, before any storage or store
   * call, and never appears in logs, scan rows, or responses.
   */
  async checkIn(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string,
    input: unknown
  ): Promise<CheckInResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "scanner.checkin");
    await this.requireEvent(organizationId, eventId);
    const request = parseRequest(checkInRequestSchema, input);
    await this.enforceScanLimits(user.id, request.deviceId);

    const credential = this.toCredential(request);
    const outcome = await this.store.checkIn({
      actorUserId: user.id,
      credential,
      deviceId: request.deviceId,
      eventId,
      organizationId,
    });
    return {
      result: outcome.result,
      scanId: outcome.scanId,
      ticket: outcome.ticket ? toTicketDetail(outcome.ticket) : null,
    };
  }

  /**
   * Reverses an accidental check-in. Requires the supervisor-only
   * scanner.reverse permission and a stated reason; the scan history keeps
   * both the original acceptance and the reversal.
   */
  async reverse(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string,
    input: unknown
  ): Promise<ReversalResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "scanner.reverse");
    await this.requireEvent(organizationId, eventId);
    const request = parseRequest(reversalRequestSchema, input);
    await this.enforceReversalLimit(user.id);

    const outcome = await this.store.reverse({
      actorUserId: user.id,
      deviceId: request.deviceId,
      eventId,
      organizationId,
      reason: request.reason,
      ticketId: request.ticketId,
    });
    if (outcome.outcome === "not_found") {
      apiError(404, "ticket_not_found", "The ticket does not exist.");
    }
    if (outcome.outcome === "not_checked_in") {
      apiError(
        409,
        "ticket_not_checked_in",
        "This ticket is not checked in, so there is nothing to reverse."
      );
    }
    return { scanId: outcome.scanId, ticket: toTicketDetail(outcome.ticket) };
  }

  /** Returns the event's recent scan attempts, newest first. */
  async activity(
    context: RequestAuthContext,
    organizationId: string,
    eventId: string
  ): Promise<ScanActivityResponse> {
    const { user } = await this.auth.requireSession(context);
    const { membership } = await this.requireActiveMembership(
      organizationId,
      user.id
    );
    this.requirePermission(membership.role, "scanner.checkin");
    await this.requireEvent(organizationId, eventId);

    const scans = await this.store.recentScans({
      eventId,
      limit: ACTIVITY_LIMIT,
      organizationId,
    });
    return {
      canReverse: hasPermission(membership.role, "scanner.reverse"),
      scans: scans.map((scan) => ({
        actorEmail: scan.actorEmail,
        createdAt: scan.createdAt.toISOString(),
        id: scan.id,
        reason: scan.reason,
        result: scan.result,
        ticketId: scan.ticketId,
        ticketPublicNumber: scan.ticketPublicNumber,
      })),
    };
  }

  private toCredential(request: {
    publicNumber?: string | undefined;
    qrToken?: string | undefined;
  }): ScanCredential {
    if (request.qrToken !== undefined) {
      return { kind: "qr", tokenHash: hashQrToken(request.qrToken) };
    }
    if (request.publicNumber !== undefined) {
      // Staff may type the nonsecret TK- code in any case.
      return {
        kind: "public_number",
        publicNumber: request.publicNumber.toUpperCase(),
      };
    }
    apiError(400, "invalid_request", "The request body is invalid.");
  }

  private async enforceScanLimits(
    userId: string,
    deviceId: string
  ): Promise<void> {
    const deviceAllowed = await this.rateLimiter.consume(
      `scan:checkin:device:${deviceId}`,
      DEVICE_SCAN_LIMIT.max,
      DEVICE_SCAN_LIMIT.windowMs
    );
    const actorAllowed = await this.rateLimiter.consume(
      `scan:checkin:actor:${userId}`,
      ACTOR_SCAN_LIMIT.max,
      ACTOR_SCAN_LIMIT.windowMs
    );
    if (!deviceAllowed || !actorAllowed) {
      apiError(429, "rate_limited", "Too many scans. Pause and retry.");
    }
  }

  private async enforceReversalLimit(userId: string): Promise<void> {
    const allowed = await this.rateLimiter.consume(
      `scan:reverse:actor:${userId}`,
      ACTOR_REVERSAL_LIMIT.max,
      ACTOR_REVERSAL_LIMIT.windowMs
    );
    if (!allowed) {
      apiError(429, "rate_limited", "Too many reversals. Pause and retry.");
    }
  }

  /**
   * Non-members get the same 404 as a missing organization so that probing
   * cannot confirm an organization exists.
   */
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
  ): Promise<void> {
    if (!uuidPattern.test(eventId)) {
      this.eventNotFound();
    }
    const event = await this.store.findEvent({ eventId, organizationId });
    if (!event) {
      this.eventNotFound();
    }
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
}

function toTicketDetail(row: ScanTicketDetailRow): ScanTicketDetail {
  return {
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    eventTitle: row.eventTitle,
    publicNumber: row.publicNumber,
    rowLabel: row.rowLabel,
    seatLabel: row.seatLabel,
    sectionName: row.sectionName,
    ticketId: row.ticketId,
    ticketTypeName: row.ticketTypeName,
  };
}
