-- Explicit refund policy, partial refund records, and durable notifications.

ALTER TABLE "events"
  ADD COLUMN "customer_refunds_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "customer_refund_cutoff_minutes" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN "inventory_return_cutoff_minutes" INTEGER NOT NULL DEFAULT 1440;

ALTER TABLE "events"
  ADD CONSTRAINT "events_refund_cutoffs_bounded"
  CHECK (
    "customer_refund_cutoff_minutes" BETWEEN 0 AND 525600
    AND "inventory_return_cutoff_minutes" BETWEEN 0 AND 525600
  );

CREATE TYPE "refund_status" AS ENUM (
  'requested', 'provider_pending', 'succeeded', 'failed'
);

CREATE TYPE "refund_initiator" AS ENUM (
  'customer', 'organizer', 'compensation'
);

CREATE TABLE "refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "request_key" VARCHAR(200) NOT NULL,
  "initiator" "refund_initiator" NOT NULL,
  "status" "refund_status" NOT NULL DEFAULT 'requested',
  "reason" VARCHAR(500),
  "amount_minor" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "provider_refund_id" VARCHAR(120),
  "provider_failure_code" VARCHAR(80),
  "inventory_returned_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refunds_amount_positive" CHECK ("amount_minor" > 0)
);

CREATE UNIQUE INDEX "refunds_order_id_request_key_key"
  ON "refunds"("order_id", "request_key");
CREATE UNIQUE INDEX "refunds_provider_refund_id_key"
  ON "refunds"("provider_refund_id");
CREATE INDEX "refunds_order_id_created_at_idx"
  ON "refunds"("order_id", "created_at" DESC);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "refund_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "refund_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "refund_items_amount_non_negative" CHECK ("amount_minor" >= 0)
);

CREATE UNIQUE INDEX "refund_items_refund_id_order_item_id_key"
  ON "refund_items"("refund_id", "order_item_id");
CREATE INDEX "refund_items_order_item_id_idx"
  ON "refund_items"("order_item_id");

ALTER TABLE "refund_items"
  ADD CONSTRAINT "refund_items_refund_id_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "refunds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refund_items"
  ADD CONSTRAINT "refund_items_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "notification_status" AS ENUM (
  'queued', 'failed', 'sent', 'suppressed'
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID,
  "user_id" UUID NOT NULL,
  "kind" VARCHAR(80) NOT NULL,
  "recipient_email" VARCHAR(320) NOT NULL,
  "deduplication_key" VARCHAR(200) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "notification_status" NOT NULL DEFAULT 'queued',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(80),
  "sent_at" TIMESTAMPTZ(6),
  "suppressed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_attempt_count_non_negative"
    CHECK ("attempt_count" >= 0)
);

CREATE UNIQUE INDEX "notifications_deduplication_key_key"
  ON "notifications"("deduplication_key");
CREATE INDEX "notifications_status_created_at_idx"
  ON "notifications"("status", "created_at");
CREATE INDEX "notifications_order_id_idx" ON "notifications"("order_id");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
