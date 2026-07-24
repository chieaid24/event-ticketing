import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

const topicPattern = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)*$/;
const codePattern = /^[a-z][a-z0-9_]*$/;

export type OutboxStatus =
  "pending" | "processing" | "completed" | "dead_letter";

export interface DatabaseExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<Row>>;
}

export interface DatabasePoolOptions {
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxConnections?: number;
}

export interface EnqueueOutboxEventInput {
  aggregateId?: string;
  aggregateType?: string;
  availableAt?: Date;
  deduplicationKey?: string;
  maxAttempts?: number;
  payload: unknown;
  topic: string;
}

export interface UpsertOutboxScheduleInput {
  active?: boolean;
  aggregateId?: string;
  aggregateType?: string;
  intervalSeconds: number;
  maxAttempts?: number;
  name: string;
  nextRunAt: Date;
  payload: unknown;
  topic: string;
}

export interface OutboxEvent {
  aggregateId: string | null;
  aggregateType: string | null;
  attemptCount: number;
  availableAt: Date;
  id: string;
  maxAttempts: number;
  payload: unknown;
  topic: string;
}

export interface OutboxFailure {
  attemptCount: number;
  availableAt: Date;
  status: "pending" | "dead_letter";
}

export interface OutboxMetrics {
  deadLetter: number;
  oldestReadyAgeSeconds: number;
  pendingDelayed: number;
  pendingReady: number;
  processing: number;
  retrying: number;
}

interface OutboxEventRow extends QueryResultRow {
  aggregateId: string | null;
  aggregateType: string | null;
  attemptCount: number;
  availableAt: Date;
  id: string;
  maxAttempts: number;
  payload: unknown;
  topic: string;
}

interface ExistingOutboxEventRow extends OutboxEventRow {
  deduplicationMatches: boolean;
}

interface OutboxFailureRow extends QueryResultRow {
  attemptCount: number;
  availableAt: Date;
  status: OutboxFailure["status"];
}

interface OutboxMetricsRow extends QueryResultRow {
  deadLetter: number;
  oldestReadyAgeSeconds: number;
  pendingDelayed: number;
  pendingReady: number;
  processing: number;
  retrying: number;
}

export class OutboxInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxInputError";
  }
}

export class OutboxDeduplicationConflictError extends Error {
  constructor() {
    super("The outbox deduplication key is already used by another event.");
    this.name = "OutboxDeduplicationConflictError";
  }
}

export class OutboxClaimError extends Error {
  constructor() {
    super("The outbox event is not claimed by this worker.");
    this.name = "OutboxClaimError";
  }
}

function assertBoundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new OutboxInputError(
      `${name} must be an integer between ${minimum} and ${maximum}.`
    );
  }
}

function assertOptionalLength(
  value: string | undefined,
  name: string,
  maximum: number
): void {
  if (value !== undefined && (value.length === 0 || value.length > maximum)) {
    throw new OutboxInputError(
      `${name} must contain between 1 and ${maximum} characters.`
    );
  }
}

function serializePayload(payload: unknown): string {
  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new OutboxInputError("payload must be JSON serializable.");
  }

  if (serialized === undefined) {
    throw new OutboxInputError("payload must be JSON serializable.");
  }

  return serialized;
}

function validateEventInput(input: EnqueueOutboxEventInput): void {
  if (!topicPattern.test(input.topic) || input.topic.length > 120) {
    throw new OutboxInputError("topic has an invalid format.");
  }

  assertOptionalLength(input.aggregateType, "aggregateType", 80);
  assertOptionalLength(input.deduplicationKey, "deduplicationKey", 200);
  assertBoundedInteger(input.maxAttempts ?? 8, "maxAttempts", 1, 100);
}

function mapEvent(row: OutboxEventRow): OutboxEvent {
  return {
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    attemptCount: row.attemptCount,
    availableAt: row.availableAt,
    id: row.id,
    maxAttempts: row.maxAttempts,
    payload: row.payload,
    topic: row.topic,
  };
}

const eventColumns = `
  "id",
  "topic",
  "payload",
  "aggregate_type" AS "aggregateType",
  "aggregate_id" AS "aggregateId",
  "available_at" AS "availableAt",
  "attempt_count" AS "attemptCount",
  "max_attempts" AS "maxAttempts"
`;

const claimedEventColumns = `
  "event"."id",
  "event"."topic",
  "event"."payload",
  "event"."aggregate_type" AS "aggregateType",
  "event"."aggregate_id" AS "aggregateId",
  "event"."available_at" AS "availableAt",
  "event"."attempt_count" AS "attemptCount",
  "event"."max_attempts" AS "maxAttempts"
`;

export function createDatabasePool(
  databaseUrl: string,
  options: DatabasePoolOptions = {}
): Pool {
  const parsedUrl = new URL(databaseUrl);
  const schema = parsedUrl.searchParams.get("schema") ?? "public";

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new OutboxInputError("DATABASE_URL contains an invalid schema name.");
  }

  parsedUrl.searchParams.delete("schema");

  return new Pool({
    connectionString: parsedUrl.toString(),
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 300_000,
    max: options.maxConnections ?? 10,
    options: `-c search_path=${schema}`,
  });
}

export async function withDatabaseTransaction<T>(
  pool: Pool,
  operation: (transaction: PoolClient) => Promise<T>
): Promise<T> {
  const transaction = await pool.connect();

  try {
    await transaction.query("BEGIN");
    const result = await operation(transaction);
    await transaction.query("COMMIT");
    return result;
  } catch (error) {
    await transaction.query("ROLLBACK");
    throw error;
  } finally {
    transaction.release();
  }
}

export async function enqueueOutboxEvent(
  executor: DatabaseExecutor,
  input: EnqueueOutboxEventInput
): Promise<OutboxEvent> {
  validateEventInput(input);
  const payload = serializePayload(input.payload);
  const values = [
    input.topic,
    payload,
    input.aggregateType ?? null,
    input.aggregateId ?? null,
    input.deduplicationKey ?? null,
    input.availableAt ?? new Date(),
    input.maxAttempts ?? 8,
  ];

  if (input.deduplicationKey === undefined) {
    const result = await executor.query<OutboxEventRow>(
      `
        INSERT INTO "outbox_events" (
          "topic",
          "payload",
          "aggregate_type",
          "aggregate_id",
          "deduplication_key",
          "available_at",
          "max_attempts"
        )
        VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
        RETURNING ${eventColumns}
      `,
      values
    );

    return mapEvent(result.rows[0]!);
  }

  const result = await executor.query<ExistingOutboxEventRow>(
    `
      WITH "inserted" AS (
        INSERT INTO "outbox_events" (
          "topic",
          "payload",
          "aggregate_type",
          "aggregate_id",
          "deduplication_key",
          "available_at",
          "max_attempts"
        )
        VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
        ON CONFLICT ("deduplication_key") DO NOTHING
        RETURNING *
      ),
      "selected" AS (
        SELECT * FROM "inserted"
        UNION ALL
        SELECT *
        FROM "outbox_events"
        WHERE "deduplication_key" = $5
          AND NOT EXISTS (SELECT 1 FROM "inserted")
      )
      SELECT
        ${eventColumns},
        (
          "topic" = $1
          AND "payload" = $2::jsonb
          AND "aggregate_type" IS NOT DISTINCT FROM $3
          AND "aggregate_id" IS NOT DISTINCT FROM $4::uuid
          AND "max_attempts" = $7
        ) AS "deduplicationMatches"
      FROM "selected"
      LIMIT 1
    `,
    values
  );
  const row =
    result.rows[0] ??
    (
      await executor.query<ExistingOutboxEventRow>(
        `
          SELECT
            ${eventColumns},
            (
              "topic" = $1
              AND "payload" = $2::jsonb
              AND "aggregate_type" IS NOT DISTINCT FROM $3
              AND "aggregate_id" IS NOT DISTINCT FROM $4::uuid
              AND "max_attempts" = $7
            ) AS "deduplicationMatches"
          FROM "outbox_events"
          WHERE "deduplication_key" = $5
          LIMIT 1
        `,
        values
      )
    ).rows[0];

  if (!row?.deduplicationMatches) {
    throw new OutboxDeduplicationConflictError();
  }

  return mapEvent(row);
}

export class OutboxRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: EnqueueOutboxEventInput): Promise<OutboxEvent> {
    return enqueueOutboxEvent(this.pool, input);
  }

  async claimBatch(input: {
    batchSize: number;
    leaseMs: number;
    workerId: string;
  }): Promise<OutboxEvent[]> {
    assertBoundedInteger(input.batchSize, "batchSize", 1, 100);
    assertBoundedInteger(input.leaseMs, "leaseMs", 1_000, 3_600_000);
    assertOptionalLength(input.workerId, "workerId", 200);

    const result = await this.pool.query<OutboxEventRow>(
      `
        WITH "claimable" AS (
          SELECT "id"
          FROM "outbox_events"
          WHERE (
            "status" = 'pending'
            AND "available_at" <= clock_timestamp()
          )
          OR (
            "status" = 'processing'
            AND "locked_until" <= clock_timestamp()
          )
          ORDER BY "available_at", "created_at", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE "outbox_events" AS "event"
        SET
          "status" = 'processing',
          "attempt_count" = LEAST(
            "event"."attempt_count" + 1,
            "event"."max_attempts"
          ),
          "locked_by" = $2,
          "locked_until" = clock_timestamp() + ($3 * interval '1 millisecond'),
          "last_error_code" = NULL,
          "updated_at" = clock_timestamp()
        FROM "claimable"
        WHERE "event"."id" = "claimable"."id"
        RETURNING ${claimedEventColumns}
      `,
      [input.batchSize, input.workerId, input.leaseMs]
    );

    return result.rows.map(mapEvent);
  }

  async hasHandlerReceipt(eventId: string): Promise<boolean> {
    const result = await this.pool.query(
      `
        SELECT 1
        FROM "outbox_handler_receipts"
        WHERE "event_id" = $1
      `,
      [eventId]
    );

    return result.rowCount === 1;
  }

  async completeEvent(input: {
    eventId: string;
    handlerName: string;
    workerId: string;
  }): Promise<void> {
    assertOptionalLength(input.handlerName, "handlerName", 120);

    await withDatabaseTransaction(this.pool, async (transaction) => {
      const claimed = await transaction.query(
        `
          SELECT 1
          FROM "outbox_events"
          WHERE "id" = $1
            AND "status" = 'processing'
            AND "locked_by" = $2
          FOR UPDATE
        `,
        [input.eventId, input.workerId]
      );

      if (claimed.rowCount !== 1) {
        throw new OutboxClaimError();
      }

      await transaction.query(
        `
          INSERT INTO "outbox_handler_receipts" ("event_id", "handler_name")
          VALUES ($1, $2)
          ON CONFLICT ("event_id") DO NOTHING
        `,
        [input.eventId, input.handlerName]
      );
      await transaction.query(
        `
          UPDATE "outbox_events"
          SET
            "status" = 'completed',
            "locked_by" = NULL,
            "locked_until" = NULL,
            "last_error_code" = NULL,
            "completed_at" = clock_timestamp(),
            "updated_at" = clock_timestamp()
          WHERE "id" = $1
        `,
        [input.eventId]
      );
    });
  }

  async failEvent(input: {
    errorCode: string;
    eventId: string;
    retryDelayMs: number;
    workerId: string;
  }): Promise<OutboxFailure> {
    if (!codePattern.test(input.errorCode) || input.errorCode.length > 80) {
      throw new OutboxInputError("errorCode has an invalid format.");
    }

    assertBoundedInteger(input.retryDelayMs, "retryDelayMs", 0, 86_400_000);

    const result = await this.pool.query<OutboxFailureRow>(
      `
        UPDATE "outbox_events"
        SET
          "status" = CASE
            WHEN "attempt_count" >= "max_attempts"
              THEN 'dead_letter'::"outbox_status"
            ELSE 'pending'::"outbox_status"
          END,
          "available_at" = CASE
            WHEN "attempt_count" >= "max_attempts"
              THEN "available_at"
            ELSE clock_timestamp() + ($4 * interval '1 millisecond')
          END,
          "locked_by" = NULL,
          "locked_until" = NULL,
          "last_error_code" = $3,
          "dead_lettered_at" = CASE
            WHEN "attempt_count" >= "max_attempts"
              THEN clock_timestamp()
            ELSE NULL
          END,
          "updated_at" = clock_timestamp()
        WHERE "id" = $1
          AND "status" = 'processing'
          AND "locked_by" = $2
        RETURNING
          "status",
          "attempt_count" AS "attemptCount",
          "available_at" AS "availableAt"
      `,
      [input.eventId, input.workerId, input.errorCode, input.retryDelayMs]
    );
    const row = result.rows[0];

    if (!row) {
      throw new OutboxClaimError();
    }

    return row;
  }

  async releaseClaims(workerId: string): Promise<number> {
    const result = await this.pool.query(
      `
        UPDATE "outbox_events"
        SET
          "status" = 'pending',
          "available_at" = clock_timestamp(),
          "locked_by" = NULL,
          "locked_until" = NULL,
          "updated_at" = clock_timestamp()
        WHERE "status" = 'processing'
          AND "locked_by" = $1
      `,
      [workerId]
    );

    return result.rowCount ?? 0;
  }

  async upsertSchedule(input: UpsertOutboxScheduleInput): Promise<string> {
    validateEventInput(input);
    assertOptionalLength(input.name, "name", 120);
    assertBoundedInteger(
      input.intervalSeconds,
      "intervalSeconds",
      1,
      31_536_000
    );
    const result = await this.pool.query<{ id: string }>(
      `
        INSERT INTO "outbox_schedules" (
          "name",
          "topic",
          "payload",
          "aggregate_type",
          "aggregate_id",
          "interval_seconds",
          "next_run_at",
          "max_attempts",
          "active"
        )
        VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
        ON CONFLICT ("name") DO UPDATE SET
          "topic" = EXCLUDED."topic",
          "payload" = EXCLUDED."payload",
          "aggregate_type" = EXCLUDED."aggregate_type",
          "aggregate_id" = EXCLUDED."aggregate_id",
          "interval_seconds" = EXCLUDED."interval_seconds",
          "next_run_at" = EXCLUDED."next_run_at",
          "max_attempts" = EXCLUDED."max_attempts",
          "active" = EXCLUDED."active",
          "updated_at" = clock_timestamp()
        RETURNING "id"
      `,
      [
        input.name,
        input.topic,
        serializePayload(input.payload),
        input.aggregateType ?? null,
        input.aggregateId ?? null,
        input.intervalSeconds,
        input.nextRunAt,
        input.maxAttempts ?? 8,
        input.active ?? true,
      ]
    );

    return result.rows[0]!.id;
  }

  async materializeDueSchedules(limit: number): Promise<number> {
    assertBoundedInteger(limit, "limit", 1, 100);
    const result = await this.pool.query<{ materialized: number }>(
      `
        WITH "due" AS MATERIALIZED (
          SELECT *
          FROM "outbox_schedules"
          WHERE "active" = TRUE
            AND "next_run_at" <= clock_timestamp()
          ORDER BY "next_run_at", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        ),
        "inserted" AS (
          INSERT INTO "outbox_events" (
            "topic",
            "payload",
            "aggregate_type",
            "aggregate_id",
            "schedule_id",
            "scheduled_for",
            "available_at",
            "max_attempts"
          )
          SELECT
            "topic",
            "payload",
            "aggregate_type",
            "aggregate_id",
            "id",
            "next_run_at",
            "next_run_at",
            "max_attempts"
          FROM "due"
          ON CONFLICT ("schedule_id", "scheduled_for") DO NOTHING
          RETURNING 1
        ),
        "advanced" AS (
          UPDATE "outbox_schedules" AS "schedule"
          SET
            "next_run_at" = "due"."next_run_at"
              + make_interval(secs => "schedule"."interval_seconds"),
            "updated_at" = clock_timestamp()
          FROM "due"
          WHERE "schedule"."id" = "due"."id"
          RETURNING 1
        )
        SELECT count(*)::int AS "materialized"
        FROM "inserted"
      `,
      [limit]
    );

    return result.rows[0]!.materialized;
  }

  async metrics(): Promise<OutboxMetrics> {
    const result = await this.pool.query<OutboxMetricsRow>(`
      SELECT
        count(*) FILTER (
          WHERE "status" = 'pending'
            AND "available_at" <= clock_timestamp()
        )::int AS "pendingReady",
        count(*) FILTER (
          WHERE "status" = 'pending'
            AND "available_at" > clock_timestamp()
        )::int AS "pendingDelayed",
        count(*) FILTER (
          WHERE "status" = 'processing'
        )::int AS "processing",
        count(*) FILTER (
          WHERE "status" = 'dead_letter'
        )::int AS "deadLetter",
        count(*) FILTER (
          WHERE "status" = 'pending'
            AND "attempt_count" > 0
        )::int AS "retrying",
        COALESCE(
          EXTRACT(
            EPOCH FROM clock_timestamp() - min("available_at") FILTER (
              WHERE "status" = 'pending'
                AND "available_at" <= clock_timestamp()
            )
          ),
          0
        )::double precision AS "oldestReadyAgeSeconds"
      FROM "outbox_events"
    `);

    return result.rows[0]!;
  }
}

export function createOutboxRepository(pool: Pool): OutboxRepository {
  return new OutboxRepository(pool);
}
