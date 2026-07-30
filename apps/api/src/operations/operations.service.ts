import type { Logger } from "pino";

import {
  analyticsRangeQuerySchema,
  retryJobRequestSchema,
  type OperationsJob,
  type OperationsJobListResponse,
  type OrganizationAnalyticsResponse,
  type OrganizationPermission,
} from "@event-ticketing/contracts";
import type {
  DailyActivityMetricRow,
  DailyFinancialMetricRow,
  FinancialMetricRow,
  MembershipRole,
  OperationsJobRow,
} from "@event-ticketing/database";

import type {
  AuthenticatedSession,
  AuthService,
  RequestAuthContext,
} from "../auth/auth.service.js";
import { hasPermission } from "../organizations/policy.js";
import { apiError, parseRequest, uuidPattern } from "../request-validation.js";
import type { OperationsStore } from "./operations.store.js";

const maximumRangeDays = 366;

function requireUuid(
  value: string,
  status: number,
  code: string,
  message: string
): void {
  if (!uuidPattern.test(value)) {
    apiError(status, code, message);
  }
}

function toCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(now: Date): { from: string; to: string } {
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: toCalendarDate(from), to: toCalendarDate(to) };
}

function rangeDays(from: string, to: string): number {
  const milliseconds =
    Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  return milliseconds / 86_400_000 + 1;
}

function databaseNumber(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("An analytics value exceeds the safe integer range.");
  }
  return parsed;
}

function financialMetric(row: FinancialMetricRow) {
  const grossMinor = databaseNumber(row.grossMinor);
  const refundMinor = databaseNumber(row.refundMinor);
  return {
    currency: row.currency.trim(),
    feeMinor: databaseNumber(row.feeMinor),
    grossMinor,
    netMinor: grossMinor - refundMinor,
    paidOrders: databaseNumber(row.paidOrders),
    refundMinor,
    ticketsSold: databaseNumber(row.ticketsSold),
  };
}

function dailyFinancialMetric(row: DailyFinancialMetricRow) {
  return {
    ...financialMetric(row),
    date: row.date,
    refundCount: databaseNumber(row.refundCount),
  };
}

function dailyActivityMetric(row: DailyActivityMetricRow) {
  return {
    acceptedCheckins: databaseNumber(row.acceptedCheckins),
    checkoutStarted: databaseNumber(row.checkoutStarted),
    date: row.date,
    duplicateScans: databaseNumber(row.duplicateScans),
    holdsCreated: databaseNumber(row.holdsCreated),
    reversedCheckins: databaseNumber(row.reversedCheckins),
  };
}

function operationsJob(row: OperationsJobRow): OperationsJob {
  return {
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    attemptCount: row.attemptCount,
    availableAt: row.availableAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    deadLetteredAt: row.deadLetteredAt?.toISOString() ?? null,
    id: row.id,
    lastErrorCode: row.lastErrorCode,
    maxAttempts: row.maxAttempts,
    organizationId: row.organizationId,
    status: row.status,
    topic: row.topic,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class OperationsService {
  constructor(
    private readonly auth: AuthService,
    private readonly store: OperationsStore,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getOrganizationAnalytics(
    context: RequestAuthContext,
    organizationId: string,
    query: unknown
  ): Promise<OrganizationAnalyticsResponse> {
    await this.requireOrganizationPermission(
      context,
      organizationId,
      "analytics.read",
      false
    );
    const parsed = parseRequest(analyticsRangeQuerySchema, query);
    const defaults = defaultRange(this.now());
    const range = {
      from: parsed.from ?? defaults.from,
      to: parsed.to ?? defaults.to,
    };
    if (rangeDays(range.from, range.to) > maximumRangeDays) {
      apiError(
        400,
        "invalid_request",
        `The analytics range cannot exceed ${maximumRangeDays} days.`
      );
    }

    const rows = await this.store.getAnalytics({
      ...range,
      organizationId,
    });
    const dailyActivity = rows.activity.map(dailyActivityMetric);
    const financials = rows.financials.map(financialMetric);
    const paidOrders = financials.reduce(
      (sum, metric) => sum + metric.paidOrders,
      0
    );
    return {
      checkins: {
        accepted: dailyActivity.reduce(
          (sum, metric) => sum + metric.acceptedCheckins,
          0
        ),
        duplicate: dailyActivity.reduce(
          (sum, metric) => sum + metric.duplicateScans,
          0
        ),
        reversed: dailyActivity.reduce(
          (sum, metric) => sum + metric.reversedCheckins,
          0
        ),
      },
      dailyActivity,
      dailyFinancials: rows.dailyFinancials.map(dailyFinancialMetric),
      financials,
      funnel: {
        checkoutStarted: dailyActivity.reduce(
          (sum, metric) => sum + metric.checkoutStarted,
          0
        ),
        holdsCreated: dailyActivity.reduce(
          (sum, metric) => sum + metric.holdsCreated,
          0
        ),
        paidOrders,
      },
      generatedAt: this.now().toISOString(),
      inventory: {
        available: databaseNumber(rows.inventory.available),
        blocked: databaseNumber(rows.inventory.blocked),
        capacity: databaseNumber(rows.inventory.capacity),
        held: databaseNumber(rows.inventory.held),
        sold: databaseNumber(rows.inventory.sold),
      },
      range,
      refunds: {
        failed: databaseNumber(rows.refunds.failed),
        requested: databaseNumber(rows.refunds.requested),
        succeeded: databaseNumber(rows.refunds.succeeded),
      },
    };
  }

  async listOrganizationJobs(
    context: RequestAuthContext,
    organizationId: string
  ): Promise<OperationsJobListResponse> {
    await this.requireOrganizationPermission(
      context,
      organizationId,
      "operations.read",
      false
    );
    return {
      jobs: (await this.store.listOrganizationJobs(organizationId)).map(
        operationsJob
      ),
    };
  }

  async retryOrganizationJob(
    context: RequestAuthContext,
    organizationId: string,
    jobId: string,
    input: unknown
  ): Promise<{ status: "accepted" }> {
    const authenticated = await this.requireOrganizationPermission(
      context,
      organizationId,
      "operations.manage",
      true
    );
    return this.retry(authenticated, jobId, input, organizationId);
  }

  async listPlatformJobs(
    context: RequestAuthContext
  ): Promise<OperationsJobListResponse> {
    await this.requirePlatformAdmin(context, false);
    return {
      jobs: (await this.store.listPlatformJobs()).map(operationsJob),
    };
  }

  async retryPlatformJob(
    context: RequestAuthContext,
    jobId: string,
    input: unknown
  ): Promise<{ status: "accepted" }> {
    const authenticated = await this.requirePlatformAdmin(context, true);
    return this.retry(authenticated, jobId, input);
  }

  private async retry(
    authenticated: AuthenticatedSession,
    jobId: string,
    input: unknown,
    organizationId?: string
  ): Promise<{ status: "accepted" }> {
    requireUuid(jobId, 404, "job_not_found", "The job does not exist.");
    const request = parseRequest(retryJobRequestSchema, input);
    const result = await this.store.retryJob({
      actorUserId: authenticated.user.id,
      expectedUpdatedAt: new Date(request.expectedUpdatedAt),
      jobId,
      ...(organizationId ? { organizationId } : {}),
    });
    if (result === "not_found") {
      apiError(404, "job_not_found", "The job does not exist.");
    }
    if (result === "not_retryable") {
      apiError(
        409,
        "job_not_retryable",
        "Only dead-letter jobs can be retried."
      );
    }
    if (result === "conflict") {
      apiError(
        409,
        "job_conflict",
        "The job changed since you loaded it. Reload and retry."
      );
    }
    this.logger.info({
      actor_user_id: authenticated.user.id,
      event: "outbox.job.retried",
      job_id: jobId,
      organization_id: organizationId ?? null,
    });
    return { status: "accepted" };
  }

  private async requirePlatformAdmin(
    context: RequestAuthContext,
    mutation: boolean
  ): Promise<AuthenticatedSession> {
    const authenticated = mutation
      ? await this.auth.requireMutationSession(context)
      : await this.auth.requireSession(context);
    if (authenticated.user.platformRole !== "admin") {
      apiError(403, "forbidden", "Platform administrator access is required.");
    }
    return authenticated;
  }

  private async requireOrganizationPermission(
    context: RequestAuthContext,
    organizationId: string,
    permission: OrganizationPermission,
    mutation: boolean
  ): Promise<AuthenticatedSession> {
    requireUuid(
      organizationId,
      404,
      "organization_not_found",
      "The organization does not exist."
    );
    const authenticated = mutation
      ? await this.auth.requireMutationSession(context)
      : await this.auth.requireSession(context);
    const [organization, membership] = await Promise.all([
      this.store.findOrganization(organizationId),
      this.store.findMembership({
        organizationId,
        userId: authenticated.user.id,
      }),
    ]);
    if (!organization || !membership || membership.status !== "active") {
      apiError(
        404,
        "organization_not_found",
        "The organization does not exist."
      );
    }
    if (!hasPermission(membership.role as MembershipRole, permission)) {
      apiError(403, "forbidden", "Your role does not allow this action.");
    }
    return authenticated;
  }
}
