import type { Pool, QueryResultRow } from "pg";

import { withDatabaseTransaction, type DatabaseExecutor } from "./outbox.js";
import { insertAuditLog } from "./organizations.js";

type DatabaseNumber = number | string;

export interface FinancialMetricRow extends QueryResultRow {
  currency: string;
  feeMinor: DatabaseNumber;
  grossMinor: DatabaseNumber;
  paidOrders: DatabaseNumber;
  refundMinor: DatabaseNumber;
  ticketsSold: DatabaseNumber;
}

export interface DailyFinancialMetricRow extends FinancialMetricRow {
  date: string;
  refundCount: DatabaseNumber;
}

export interface DailyActivityMetricRow extends QueryResultRow {
  acceptedCheckins: DatabaseNumber;
  checkoutStarted: DatabaseNumber;
  date: string;
  duplicateScans: DatabaseNumber;
  holdsCreated: DatabaseNumber;
  reversedCheckins: DatabaseNumber;
}

export interface InventoryMetricRow extends QueryResultRow {
  available: DatabaseNumber;
  blocked: DatabaseNumber;
  capacity: DatabaseNumber;
  held: DatabaseNumber;
  sold: DatabaseNumber;
}

export interface RefundMetricRow extends QueryResultRow {
  failed: DatabaseNumber;
  requested: DatabaseNumber;
  succeeded: DatabaseNumber;
}

export interface OperationsJobRow extends QueryResultRow {
  aggregateId: string | null;
  aggregateType: string | null;
  attemptCount: number;
  availableAt: Date;
  createdAt: Date;
  deadLetteredAt: Date | null;
  id: string;
  lastErrorCode: string | null;
  maxAttempts: number;
  organizationId: string | null;
  status: "pending" | "processing" | "completed" | "dead_letter";
  topic: string;
  updatedAt: Date;
}

export interface OrganizationAnalyticsRows {
  activity: DailyActivityMetricRow[];
  dailyFinancials: DailyFinancialMetricRow[];
  financials: FinancialMetricRow[];
  inventory: InventoryMetricRow;
  refunds: RefundMetricRow;
}

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const organizationJobResolution = `
  SELECT
    "outbox".*,
    COALESCE(
      CASE
        WHEN "outbox"."aggregate_type" = 'organization'
          THEN "outbox"."aggregate_id"
        ELSE NULL
      END,
      "aggregate_event"."organization_id",
      "aggregate_order_event"."organization_id",
      "payload_event"."organization_id",
      "payload_order_event"."organization_id",
      "payload_refund_event"."organization_id",
      "payload_notification_event"."organization_id",
      CASE
        WHEN ("outbox"."payload"->>'organizationId') ~ '${uuidPattern}'
          THEN ("outbox"."payload"->>'organizationId')::uuid
        ELSE NULL
      END
    ) AS "organizationId"
  FROM "outbox_events" AS "outbox"
  LEFT JOIN "events" AS "aggregate_event"
    ON "outbox"."aggregate_type" = 'event'
    AND "aggregate_event"."id" = "outbox"."aggregate_id"
  LEFT JOIN "orders" AS "aggregate_order"
    ON "outbox"."aggregate_type" = 'order'
    AND "aggregate_order"."id" = "outbox"."aggregate_id"
  LEFT JOIN "events" AS "aggregate_order_event"
    ON "aggregate_order_event"."id" = "aggregate_order"."event_id"
  LEFT JOIN "events" AS "payload_event"
    ON "payload_event"."id" = CASE
      WHEN ("outbox"."payload"->>'eventId') ~ '${uuidPattern}'
        THEN ("outbox"."payload"->>'eventId')::uuid
      ELSE NULL
    END
  LEFT JOIN "orders" AS "payload_order"
    ON "payload_order"."id" = CASE
      WHEN ("outbox"."payload"->>'orderId') ~ '${uuidPattern}'
        THEN ("outbox"."payload"->>'orderId')::uuid
      ELSE NULL
    END
  LEFT JOIN "events" AS "payload_order_event"
    ON "payload_order_event"."id" = "payload_order"."event_id"
  LEFT JOIN "refunds" AS "payload_refund"
    ON "payload_refund"."id" = CASE
      WHEN ("outbox"."payload"->>'refundId') ~ '${uuidPattern}'
        THEN ("outbox"."payload"->>'refundId')::uuid
      ELSE NULL
    END
  LEFT JOIN "orders" AS "payload_refund_order"
    ON "payload_refund_order"."id" = "payload_refund"."order_id"
  LEFT JOIN "events" AS "payload_refund_event"
    ON "payload_refund_event"."id" = "payload_refund_order"."event_id"
  LEFT JOIN "notifications" AS "payload_notification"
    ON "payload_notification"."id" = CASE
      WHEN ("outbox"."payload"->>'notificationId') ~ '${uuidPattern}'
        THEN ("outbox"."payload"->>'notificationId')::uuid
      ELSE NULL
    END
  LEFT JOIN "orders" AS "payload_notification_order"
    ON "payload_notification_order"."id" = "payload_notification"."order_id"
  LEFT JOIN "events" AS "payload_notification_event"
    ON "payload_notification_event"."id"
      = "payload_notification_order"."event_id"
`;

const jobColumns = `
  "id",
  "topic",
  "aggregate_type" AS "aggregateType",
  "aggregate_id" AS "aggregateId",
  "status",
  "available_at" AS "availableAt",
  "attempt_count" AS "attemptCount",
  "max_attempts" AS "maxAttempts",
  "last_error_code" AS "lastErrorCode",
  "dead_lettered_at" AS "deadLetteredAt",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt",
  "organizationId"
`;

export async function getOrganizationAnalytics(
  executor: DatabaseExecutor,
  input: { from: string; organizationId: string; to: string }
): Promise<OrganizationAnalyticsRows> {
  const values = [input.organizationId, input.from, input.to];
  const [financials, dailyFinancials, activity, inventory, refunds] =
    await Promise.all([
      executor.query<FinancialMetricRow>(
        `
        SELECT
          "currency",
          SUM("paid_orders") AS "paidOrders",
          SUM("tickets_sold") AS "ticketsSold",
          SUM("gross_minor") AS "grossMinor",
          SUM("fee_minor") AS "feeMinor",
          SUM("refund_minor") AS "refundMinor"
        FROM "analytics_daily_financials"
        WHERE "organization_id" = $1
          AND "day" BETWEEN $2::date AND $3::date
        GROUP BY "currency"
        ORDER BY "currency"
      `,
        values
      ),
      executor.query<DailyFinancialMetricRow>(
        `
        SELECT
          to_char("day", 'YYYY-MM-DD') AS "date",
          "currency",
          "paid_orders" AS "paidOrders",
          "tickets_sold" AS "ticketsSold",
          "gross_minor" AS "grossMinor",
          "fee_minor" AS "feeMinor",
          "refund_count" AS "refundCount",
          "refund_minor" AS "refundMinor"
        FROM "analytics_daily_financials"
        WHERE "organization_id" = $1
          AND "day" BETWEEN $2::date AND $3::date
        ORDER BY "day", "currency"
      `,
        values
      ),
      executor.query<DailyActivityMetricRow>(
        `
        SELECT
          to_char("day", 'YYYY-MM-DD') AS "date",
          "holds_created" AS "holdsCreated",
          "checkout_started" AS "checkoutStarted",
          "accepted_checkins" AS "acceptedCheckins",
          "duplicate_scans" AS "duplicateScans",
          "reversed_checkins" AS "reversedCheckins"
        FROM "analytics_daily_activity"
        WHERE "organization_id" = $1
          AND "day" BETWEEN $2::date AND $3::date
        ORDER BY "day"
      `,
        values
      ),
      executor.query<InventoryMetricRow>(
        `
        WITH "assigned" AS (
          SELECT
            COUNT(*) AS "capacity",
            COUNT(*) FILTER (WHERE "event_seats"."status" = 'available')
              AS "available",
            COUNT(*) FILTER (WHERE "event_seats"."status" = 'held') AS "held",
            COUNT(*) FILTER (WHERE "event_seats"."status" = 'sold') AS "sold",
            COUNT(*) FILTER (WHERE "event_seats"."status" = 'blocked')
              AS "blocked"
          FROM "event_seats"
          INNER JOIN "events" ON "events"."id" = "event_seats"."event_id"
          WHERE "events"."organization_id" = $1
        ),
        "generalAdmission" AS (
          SELECT
            COALESCE(SUM("ticket_types"."capacity"), 0) AS "capacity",
            COALESCE(SUM(
              "ticket_types"."capacity"
              - "ticket_types"."reserved_quantity"
              - "ticket_types"."sold_quantity"
            ), 0) AS "available",
            COALESCE(SUM("ticket_types"."reserved_quantity"), 0) AS "held",
            COALESCE(SUM("ticket_types"."sold_quantity"), 0) AS "sold",
            0 AS "blocked"
          FROM "ticket_types"
          INNER JOIN "events" ON "events"."id" = "ticket_types"."event_id"
          WHERE "events"."organization_id" = $1
            AND "ticket_types"."kind" = 'general_admission'
        )
        SELECT
          ("assigned"."capacity" + "generalAdmission"."capacity") AS "capacity",
          ("assigned"."available" + "generalAdmission"."available") AS "available",
          ("assigned"."held" + "generalAdmission"."held") AS "held",
          ("assigned"."sold" + "generalAdmission"."sold") AS "sold",
          ("assigned"."blocked" + "generalAdmission"."blocked") AS "blocked"
        FROM "assigned", "generalAdmission"
      `,
        [input.organizationId]
      ),
      executor.query<RefundMetricRow>(
        `
        SELECT
          COUNT(*) FILTER (WHERE "refunds"."status" IN (
            'requested', 'provider_pending'
          )) AS "requested",
          COUNT(*) FILTER (WHERE "refunds"."status" = 'succeeded')
            AS "succeeded",
          COUNT(*) FILTER (WHERE "refunds"."status" = 'failed') AS "failed"
        FROM "refunds"
        INNER JOIN "orders" ON "orders"."id" = "refunds"."order_id"
        INNER JOIN "events" ON "events"."id" = "orders"."event_id"
        WHERE "events"."organization_id" = $1
          AND "refunds"."created_at" >= $2::date
          AND "refunds"."created_at" < ($3::date + interval '1 day')
      `,
        values
      ),
    ]);

  return {
    activity: activity.rows,
    dailyFinancials: dailyFinancials.rows,
    financials: financials.rows,
    inventory: inventory.rows[0]!,
    refunds: refunds.rows[0]!,
  };
}

export async function listOrganizationJobs(
  executor: DatabaseExecutor,
  input: { limit: number; organizationId: string }
): Promise<OperationsJobRow[]> {
  const result = await executor.query<OperationsJobRow>(
    `
      WITH "resolved" AS (${organizationJobResolution})
      SELECT ${jobColumns}
      FROM "resolved"
      WHERE "organizationId" = $1
      ORDER BY
        CASE WHEN "status" = 'dead_letter' THEN 0 ELSE 1 END,
        "created_at" DESC,
        "id"
      LIMIT $2
    `,
    [input.organizationId, input.limit]
  );
  return result.rows;
}

export async function listPlatformJobs(
  executor: DatabaseExecutor,
  limit: number
): Promise<OperationsJobRow[]> {
  const result = await executor.query<OperationsJobRow>(
    `
      WITH "resolved" AS (${organizationJobResolution})
      SELECT ${jobColumns}
      FROM "resolved"
      ORDER BY
        CASE WHEN "status" = 'dead_letter' THEN 0 ELSE 1 END,
        "created_at" DESC,
        "id"
      LIMIT $1
    `,
    [limit]
  );
  return result.rows;
}

export type RetryJobResult =
  "retried" | "not_found" | "not_retryable" | "conflict";

export async function retryOperationsJob(
  pool: Pool,
  input: {
    actorUserId: string;
    expectedUpdatedAt: Date;
    jobId: string;
    organizationId?: string;
  }
): Promise<RetryJobResult> {
  return withDatabaseTransaction(pool, async (transaction) => {
    const locked = await transaction.query(
      `
        SELECT 1
        FROM "outbox_events"
        WHERE "id" = $1
        FOR UPDATE
      `,
      [input.jobId]
    );
    if (locked.rowCount !== 1) {
      return "not_found";
    }

    const result = await transaction.query<OperationsJobRow>(
      `
        WITH "resolved" AS (${organizationJobResolution})
        SELECT ${jobColumns}
        FROM "resolved"
        WHERE "id" = $1
          AND ($2::uuid IS NULL OR "organizationId" = $2)
      `,
      [input.jobId, input.organizationId ?? null]
    );
    const job = result.rows[0];
    if (!job) {
      return "not_found";
    }
    if (job.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      return "conflict";
    }
    if (job.status !== "dead_letter") {
      return "not_retryable";
    }

    await transaction.query(
      `
        UPDATE "outbox_events"
        SET
          "status" = 'pending',
          "available_at" = clock_timestamp(),
          "attempt_count" = 0,
          "locked_by" = NULL,
          "locked_until" = NULL,
          "last_error_code" = NULL,
          "dead_lettered_at" = NULL,
          "updated_at" = clock_timestamp()
        WHERE "id" = $1
      `,
      [input.jobId]
    );
    await insertAuditLog(transaction, {
      action: "job.retried",
      actorUserId: input.actorUserId,
      detail: { topic: job.topic },
      organizationId: job.organizationId,
      targetId: job.id,
      targetType: "outbox_event",
    });
    return "retried";
  });
}
