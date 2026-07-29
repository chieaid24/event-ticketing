import {
  type QrRevealResponse,
  type TicketListResponse,
  type TicketSummary,
} from "@event-ticketing/contracts";
import {
  generateAuthSecret,
  hashQrToken,
  TicketNotFoundError,
  type TicketAccessRecord,
} from "@event-ticketing/database";

import type { AuthService, RequestAuthContext } from "../auth/auth.service.js";
import { apiError, uuidPattern } from "../request-validation.js";
import type { TicketsStore } from "./tickets.store.js";

export class TicketsService {
  constructor(
    private readonly auth: AuthService,
    private readonly store: TicketsStore
  ) {}

  async listTickets(context: RequestAuthContext): Promise<TicketListResponse> {
    const { user } = await this.auth.requireSession(context);
    const tickets = await this.store.listTickets({ userId: user.id });
    return { tickets: tickets.map(toSummary) };
  }

  async getTicket(
    context: RequestAuthContext,
    ticketId: string
  ): Promise<TicketSummary> {
    const { user } = await this.auth.requireSession(context);
    this.assertTicketId(ticketId);
    try {
      const ticket = await this.store.loadTicket({
        actor: { userId: user.id },
        ticketId,
      });
      return toSummary(ticket);
    } catch (error) {
      this.translate(error);
    }
  }

  /**
   * Mints a fresh QR bearer for an active ticket and returns it exactly once.
   * Rotating replaces the stored hash, so any previously revealed bearer stops
   * matching. The raw value lives only in this response - never persisted,
   * never logged. Rotation is a state change, so it demands a mutation session.
   */
  async revealQr(
    context: RequestAuthContext,
    ticketId: string
  ): Promise<QrRevealResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    this.assertTicketId(ticketId);

    const token = generateAuthSecret();
    let outcome;
    try {
      outcome = await this.store.rotateQr({
        actor: { userId: user.id },
        ticketId,
        tokenHash: hashQrToken(token),
      });
    } catch (error) {
      this.translate(error);
    }

    if (outcome.outcome === "not_active") {
      apiError(
        409,
        "ticket_not_active",
        "This ticket is no longer active and has no QR code."
      );
    }

    return {
      publicNumber: outcome.publicNumber,
      rotatedAt: outcome.rotatedAt.toISOString(),
      ticketId,
      token,
    };
  }

  private assertTicketId(ticketId: string): void {
    if (!uuidPattern.test(ticketId)) {
      apiError(404, "ticket_not_found", "The ticket does not exist.");
    }
  }

  private translate(error: unknown): never {
    if (error instanceof TicketNotFoundError) {
      apiError(404, "ticket_not_found", "The ticket does not exist.");
    }
    throw error;
  }
}

function toSummary(record: TicketAccessRecord): TicketSummary {
  return {
    eventEndsAt: record.eventEndsAt?.toISOString() ?? null,
    eventId: record.eventId,
    eventStartsAt: record.eventStartsAt?.toISOString() ?? null,
    eventStatus: record.eventStatus,
    eventTimezone: record.eventTimezone,
    eventTitle: record.eventTitle,
    id: record.id,
    orderId: record.orderId,
    orderPublicNumber: record.orderPublicNumber,
    publicNumber: record.publicNumber,
    qrRotatedAt: record.qrRotatedAt?.toISOString() ?? null,
    rowLabel: record.rowLabel,
    seatAccessible: record.seatAccessible,
    seatLabel: record.seatLabel,
    sectionName: record.sectionName,
    status: record.status,
    ticketTypeKind: record.ticketTypeKind,
    ticketTypeName: record.ticketTypeName,
    venueDescription: record.venueDescription,
    venueName: record.venueName,
  };
}
