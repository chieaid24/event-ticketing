import { HttpException } from "@nestjs/common";

import {
  createAssignedSeatHoldRequestSchema,
  createGeneralAdmissionHoldRequestSchema,
  idempotencyKeySchema,
  type CreateAssignedSeatHoldResponse,
  type CreateGeneralAdmissionHoldResponse,
  type SupportedCurrency,
} from "@event-ticketing/contracts";
import {
  HoldCapacityError,
  HoldEventNotFoundError,
  HoldInputError,
  SeatsUnavailableError,
  type AssignedSeatHoldRecord,
} from "@event-ticketing/database";

import type { AuthService, RequestAuthContext } from "../auth/auth.service.js";
import { apiError, parseRequest } from "../request-validation.js";
import type { GeneralAdmissionHoldRecord, HoldsStore } from "./holds.store.js";

/** Route identifier for rate limiting and telemetry. */
export const HOLD_ROUTE = "holds.assigned.create";

export class HoldsService {
  constructor(
    private readonly auth: AuthService,
    private readonly store: HoldsStore
  ) {}

  async createAssignedSeatHold(
    context: RequestAuthContext,
    idempotencyKey: string | undefined,
    input: unknown
  ): Promise<CreateAssignedSeatHoldResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const key = this.requireIdempotencyKey(idempotencyKey);
    const request = parseRequest(createAssignedSeatHoldRequestSchema, input);

    try {
      // Idempotency is already actor-scoped by the unique (actor, key) index, so
      // the client key is stored as-is and keeps its full length budget.
      const hold = await this.store.createAssignedSeatHold({
        actor: { userId: user.id },
        eventId: request.eventId,
        idempotencyKey: key,
        seatIds: request.seatIds,
      });
      return this.toResponse(hold);
    } catch (error) {
      this.translate(error);
    }
  }

  async createGeneralAdmissionHold(
    context: RequestAuthContext,
    idempotencyKey: string | undefined,
    input: unknown
  ): Promise<CreateGeneralAdmissionHoldResponse> {
    const { user } = await this.auth.requireMutationSession(context);
    const key = this.requireIdempotencyKey(idempotencyKey);
    const request = parseRequest(
      createGeneralAdmissionHoldRequestSchema,
      input
    );

    try {
      const hold = await this.store.createGeneralAdmissionHold({
        actor: { userId: user.id },
        eventId: request.eventId,
        idempotencyKey: key,
        items: request.items,
      });
      return this.toGeneralAdmissionResponse(hold);
    } catch (error) {
      this.translate(error);
    }
  }

  private toGeneralAdmissionResponse(
    hold: GeneralAdmissionHoldRecord
  ): CreateGeneralAdmissionHoldResponse {
    let subtotalMinor = 0;
    let feeMinor = 0;
    for (const item of hold.items) {
      subtotalMinor += item.quantity * item.unitPriceMinor;
      feeMinor += item.quantity * item.unitFeeMinor;
    }
    return {
      currency: hold.currency as SupportedCurrency,
      eventId: hold.eventId,
      expiresAt: hold.expiresAt.toISOString(),
      feeMinor,
      holdId: hold.id,
      items: hold.items.map((item) => ({
        quantity: item.quantity,
        ticketTypeId: item.ticketTypeId,
        unitFeeMinor: item.unitFeeMinor,
        unitPriceMinor: item.unitPriceMinor,
      })),
      status: hold.status,
      subtotalMinor,
      totalMinor: subtotalMinor + feeMinor,
    };
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const parsed = idempotencyKeySchema.safeParse(value);
    if (!parsed.success) {
      apiError(
        400,
        "idempotency_key_required",
        "A valid Idempotency-Key header is required."
      );
    }
    return parsed.data;
  }

  private toResponse(
    hold: AssignedSeatHoldRecord
  ): CreateAssignedSeatHoldResponse {
    return {
      currency: hold.currency as SupportedCurrency,
      eventId: hold.eventId,
      expiresAt: hold.expiresAt.toISOString(),
      feeMinor: hold.feeMinor,
      holdId: hold.id,
      seats: hold.seats.map((seat) => ({
        eventSeatId: seat.eventSeatId,
        rowLabel: seat.rowLabel,
        seatLabel: seat.seatLabel,
        sectionName: seat.sectionName,
        ticketTypeId: seat.ticketTypeId,
        unitFeeMinor: seat.unitFeeMinor,
        unitPriceMinor: seat.unitPriceMinor,
      })),
      status: hold.status,
      subtotalMinor: hold.subtotalMinor,
      totalMinor: hold.totalMinor,
    };
  }

  private translate(error: unknown): never {
    if (error instanceof SeatsUnavailableError) {
      // Disclose only the unavailable seat ids, never another customer's hold.
      throw new HttpException(
        {
          code: "seats_unavailable",
          message: "One or more requested seats are no longer available.",
          seatIds: error.seatIds,
        },
        409
      );
    }
    if (error instanceof HoldCapacityError) {
      // Disclose only the oversubscribed ticket types, never another hold.
      throw new HttpException(
        {
          code: "capacity_unavailable",
          message: "The requested quantity is no longer available.",
          ticketTypeIds: error.unavailableTicketTypeIds,
        },
        409
      );
    }
    if (error instanceof HoldEventNotFoundError) {
      apiError(404, "event_not_found", "The event does not exist.");
    }
    if (error instanceof HoldInputError) {
      apiError(400, "invalid_request", "The hold request is invalid.");
    }
    throw error;
  }
}
