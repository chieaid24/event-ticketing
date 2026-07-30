import {
  createOrganizerRefundRequestSchema,
  createRefundRequestSchema,
  type RefundListResponse,
  type RefundSummary,
  type SupportedCurrency,
} from "@event-ticketing/contracts";
import {
  RefundNotFoundError,
  RefundStateError,
  type RefundRecord,
} from "@event-ticketing/database";

import type { RequestAuthContext } from "../auth/auth.service.js";
import type { SessionAuthenticator } from "../organizations/organizations.service.js";
import { hasPermission } from "../organizations/policy.js";
import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import type { RefundsStore } from "./refunds.store.js";

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,200}$/;

function toSummary(refund: RefundRecord): RefundSummary {
  return {
    amountMinor: refund.amountMinor,
    completedAt: refund.completedAt?.toISOString() ?? null,
    createdAt: refund.createdAt.toISOString(),
    currency: refund.currency as SupportedCurrency,
    id: refund.id,
    initiator: refund.initiator,
    inventoryReturnedAt: refund.inventoryReturnedAt?.toISOString() ?? null,
    items: refund.items,
    orderId: refund.orderId,
    reason: refund.reason,
    status: refund.status,
  };
}

export class RefundsService {
  constructor(
    private readonly auth: SessionAuthenticator,
    private readonly store: RefundsStore
  ) {}

  async createCustomerRefund(
    context: RequestAuthContext,
    orderId: string,
    idempotencyKey: string | undefined,
    input: unknown
  ): Promise<RefundSummary> {
    const { user } = await this.auth.requireMutationSession(context);
    this.requireOrderId(orderId);
    const key = this.requireIdempotencyKey(idempotencyKey);
    const request = parseRequest(createRefundRequestSchema, input);
    try {
      return toSummary(
        await this.store.createCustomerRefund({
          idempotencyKey: key,
          items: request.items,
          orderId,
          userId: user.id,
        })
      );
    } catch (error) {
      this.translate(error);
    }
  }

  async createOrganizerRefund(
    context: RequestAuthContext,
    organizationId: string,
    orderId: string,
    idempotencyKey: string | undefined,
    input: unknown
  ): Promise<RefundSummary> {
    const { user } = await this.auth.requireMutationSession(context);
    this.requireOrganizationId(organizationId);
    this.requireOrderId(orderId);
    const key = this.requireIdempotencyKey(idempotencyKey);
    const request = parseRequest(createOrganizerRefundRequestSchema, input);
    const [organization, membership] = await Promise.all([
      this.store.findOrganization(organizationId),
      this.store.findMembership({ organizationId, userId: user.id }),
    ]);
    if (!organization || !membership || membership.status !== "active") {
      this.organizationNotFound();
    }
    if (!hasPermission(membership.role, "finance.manage")) {
      apiError(403, "forbidden", "Your role does not allow this action.");
    }
    try {
      return toSummary(
        await this.store.createOrganizerRefund({
          actorUserId: user.id,
          idempotencyKey: key,
          items: request.items,
          orderId,
          organizationId,
          reason: request.reason,
        })
      );
    } catch (error) {
      this.translate(error);
    }
  }

  async listCustomerRefunds(
    context: RequestAuthContext,
    orderId: string
  ): Promise<RefundListResponse> {
    const { user } = await this.auth.requireSession(context);
    this.requireOrderId(orderId);
    const refunds = await this.store.listCustomerRefunds({
      orderId,
      userId: user.id,
    });
    if (refunds.length === 0) {
      return { refunds: [] };
    }
    return { refunds: refunds.map(toSummary) };
  }

  private requireIdempotencyKey(value: string | undefined): string {
    if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
      apiError(
        400,
        "idempotency_key_required",
        "Send a printable Idempotency-Key header of at most 200 characters."
      );
    }
    return value;
  }

  private requireOrderId(orderId: string): void {
    if (!uuidPattern.test(orderId)) {
      apiError(404, "order_not_found", "The order does not exist.");
    }
  }

  private requireOrganizationId(organizationId: string): void {
    if (!uuidPattern.test(organizationId)) {
      this.organizationNotFound();
    }
  }

  private organizationNotFound(): never {
    apiError(404, "organization_not_found", "The organization does not exist.");
  }

  private translate(error: unknown): never {
    if (error instanceof RefundNotFoundError) {
      apiError(404, "order_not_found", "The order does not exist.");
    }
    if (error instanceof RefundStateError) {
      const status =
        error.code === "refund_item_not_found"
          ? 400
          : error.code === "refund_amount_zero"
            ? 422
            : 409;
      apiError(status, error.code, error.message);
    }
    throw error;
  }
}
