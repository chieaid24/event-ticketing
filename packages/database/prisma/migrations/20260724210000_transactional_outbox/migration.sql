CREATE TYPE "outbox_status" AS ENUM (
  'pending',
  'processing',
  'completed',
  'dead_letter'
);

CREATE TABLE "outbox_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(120) NOT NULL,
  "topic" VARCHAR(120) NOT NULL,
  "payload" JSONB NOT NULL,
  "aggregate_type" VARCHAR(80),
  "aggregate_id" UUID,
  "interval_seconds" INTEGER NOT NULL,
  "next_run_at" TIMESTAMPTZ(6) NOT NULL,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_schedules_topic_format" CHECK (
    "topic" ~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)*$'
  ),
  CONSTRAINT "outbox_schedules_interval_bounds" CHECK (
    "interval_seconds" BETWEEN 1 AND 31536000
  ),
  CONSTRAINT "outbox_schedules_attempt_bounds" CHECK (
    "max_attempts" BETWEEN 1 AND 100
  )
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "topic" VARCHAR(120) NOT NULL,
  "payload" JSONB NOT NULL,
  "aggregate_type" VARCHAR(80),
  "aggregate_id" UUID,
  "deduplication_key" VARCHAR(200),
  "schedule_id" UUID,
  "scheduled_for" TIMESTAMPTZ(6),
  "status" "outbox_status" NOT NULL DEFAULT 'pending',
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "locked_by" VARCHAR(200),
  "locked_until" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(80),
  "completed_at" TIMESTAMPTZ(6),
  "dead_lettered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_topic_format" CHECK (
    "topic" ~ '^[a-z][a-z0-9]*(\.[a-z0-9]+)*$'
  ),
  CONSTRAINT "outbox_events_attempt_bounds" CHECK (
    "attempt_count" BETWEEN 0 AND "max_attempts"
    AND "max_attempts" BETWEEN 1 AND 100
  ),
  CONSTRAINT "outbox_events_error_code_format" CHECK (
    "last_error_code" IS NULL
    OR "last_error_code" ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT "outbox_events_schedule_fields" CHECK (
    ("schedule_id" IS NULL AND "scheduled_for" IS NULL)
    OR ("schedule_id" IS NOT NULL AND "scheduled_for" IS NOT NULL)
  ),
  CONSTRAINT "outbox_events_state_fields" CHECK (
    (
      "status" = 'pending'
      AND "locked_by" IS NULL
      AND "locked_until" IS NULL
      AND "completed_at" IS NULL
      AND "dead_lettered_at" IS NULL
    )
    OR (
      "status" = 'processing'
      AND "locked_by" IS NOT NULL
      AND "locked_until" IS NOT NULL
      AND "completed_at" IS NULL
      AND "dead_lettered_at" IS NULL
    )
    OR (
      "status" = 'completed'
      AND "locked_by" IS NULL
      AND "locked_until" IS NULL
      AND "completed_at" IS NOT NULL
      AND "dead_lettered_at" IS NULL
    )
    OR (
      "status" = 'dead_letter'
      AND "locked_by" IS NULL
      AND "locked_until" IS NULL
      AND "completed_at" IS NULL
      AND "dead_lettered_at" IS NOT NULL
      AND "last_error_code" IS NOT NULL
    )
  )
);

CREATE TABLE "outbox_handler_receipts" (
  "event_id" UUID NOT NULL,
  "handler_name" VARCHAR(120) NOT NULL,
  "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_handler_receipts_pkey" PRIMARY KEY ("event_id")
);

CREATE UNIQUE INDEX "outbox_schedules_name_key"
  ON "outbox_schedules"("name");
CREATE INDEX "outbox_schedules_due_idx"
  ON "outbox_schedules"("next_run_at", "id");
CREATE UNIQUE INDEX "outbox_events_deduplication_key_key"
  ON "outbox_events"("deduplication_key");
CREATE UNIQUE INDEX "outbox_events_schedule_id_scheduled_for_key"
  ON "outbox_events"("schedule_id", "scheduled_for");
CREATE INDEX "outbox_events_ready_idx"
  ON "outbox_events"("available_at", "created_at", "id");
CREATE INDEX "outbox_events_expired_claim_idx"
  ON "outbox_events"("locked_until", "id");
CREATE INDEX "outbox_events_dead_letter_idx"
  ON "outbox_events"("dead_lettered_at", "id");

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "outbox_schedules"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbox_handler_receipts"
  ADD CONSTRAINT "outbox_handler_receipts_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "outbox_events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
