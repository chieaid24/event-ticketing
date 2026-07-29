-- Orders, payments, tickets, and durable webhook receipts for idempotent
-- checkout and verified Stripe finalization.

CREATE TYPE "order_status" AS ENUM (
  'pending_payment', 'paid', 'payment_conflict', 'refunded'
);

CREATE TYPE "payment_status" AS ENUM (
  'requires_payment', 'succeeded', 'refund_pending', 'refunded'
);

CREATE TYPE "ticket_status" AS ENUM ('active', 'void');

-- The immutable commercial record created from one hold. The unique hold_id is
-- the whole guard for "one order per hold" (invariant #8): duplicate checkout
-- inserts conflict here and replay the existing order.
CREATE TABLE "orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "public_number" VARCHAR(20) NOT NULL,
  "hold_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "user_id" UUID,
  "guest_session_id" VARCHAR(64),
  "actor_key" VARCHAR(80) NOT NULL,
  "status" "order_status" NOT NULL DEFAULT 'pending_payment',
  "currency" CHAR(3) NOT NULL,
  "subtotal_minor" INTEGER NOT NULL,
  "fee_minor" INTEGER NOT NULL,
  "total_minor" INTEGER NOT NULL,
  "paid_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_public_number_key" ON "orders"("public_number");
CREATE UNIQUE INDEX "orders_hold_id_key" ON "orders"("hold_id");
CREATE INDEX "orders_actor_key_created_at_idx"
  ON "orders"("actor_key", "created_at" DESC);
CREATE INDEX "orders_event_id_idx" ON "orders"("event_id");

-- Exactly one of user or guest owns an order, mirroring holds_one_actor.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_one_actor"
    CHECK (("user_id" IS NULL) <> ("guest_session_id" IS NULL));

-- Server-calculated money only; totals are non-negative integers in minor units.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_money_non_negative"
    CHECK ("subtotal_minor" >= 0 AND "fee_minor" >= 0 AND "total_minor" >= 0);

-- RESTRICT: an order is an immutable commercial record; the hold, event, and
-- price snapshot it came from must not vanish underneath it.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_hold_id_fkey"
  FOREIGN KEY ("hold_id") REFERENCES "holds"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Priced line snapshot copied from the hold at checkout.
CREATE TABLE "order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "ticket_type_id" UUID NOT NULL,
  "event_seat_id" UUID,
  "quantity" INTEGER NOT NULL,
  "unit_price_minor" INTEGER NOT NULL,
  "unit_fee_minor" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_ticket_type_id_idx" ON "order_items"("ticket_type_id");
CREATE INDEX "order_items_event_seat_id_idx" ON "order_items"("event_seat_id");

-- Assigned lines carry exactly one seat at quantity one; general-admission
-- lines carry a null seat and a positive quantity.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_assigned_single_seat"
    CHECK ("event_seat_id" IS NULL OR "quantity" = 1);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" >= 1);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_ticket_type_id_fkey"
  FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_event_seat_id_fkey"
  FOREIGN KEY ("event_seat_id") REFERENCES "event_seats"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kind-specific uniqueness mirrors hold_items: one line per ticket type for
-- general admission, one line per seat for assigned.
CREATE UNIQUE INDEX "order_items_order_ticket_type_ga_key"
  ON "order_items"("order_id", "ticket_type_id")
  WHERE "event_seat_id" IS NULL;

CREATE UNIQUE INDEX "order_items_order_seat_key"
  ON "order_items"("order_id", "event_seat_id")
  WHERE "event_seat_id" IS NOT NULL;

-- One payment per order; retried card attempts reuse the same logical intent,
-- so the provider intent id is unique and stable across replays.
CREATE TABLE "payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "provider_payment_intent_id" VARCHAR(120),
  "client_secret" VARCHAR(200),
  "amount_minor" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "payment_status" NOT NULL DEFAULT 'requires_payment',
  "last_failure_code" VARCHAR(80),
  "last_failure_at" TIMESTAMPTZ(6),
  "provider_refund_id" VARCHAR(120),
  "refunded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");
CREATE UNIQUE INDEX "payments_provider_payment_intent_id_key"
  ON "payments"("provider_payment_intent_id");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One issued admission credential per purchased unit. QR token storage arrives
-- with ticket issuance; this table anchors "duplicate events create one ticket
-- set" for finalization.
CREATE TABLE "tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "ticket_type_id" UUID NOT NULL,
  "event_seat_id" UUID,
  "status" "ticket_status" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tickets_order_id_idx" ON "tickets"("order_id");
CREATE INDEX "tickets_event_id_idx" ON "tickets"("event_id");
CREATE INDEX "tickets_order_item_id_idx" ON "tickets"("order_item_id");
CREATE INDEX "tickets_ticket_type_id_idx" ON "tickets"("ticket_type_id");
CREATE INDEX "tickets_event_seat_id_idx" ON "tickets"("event_seat_id");

-- At most one live admission per assigned seat (invariant #1, sale side).
CREATE UNIQUE INDEX "tickets_active_seat_key"
  ON "tickets"("event_seat_id")
  WHERE "event_seat_id" IS NOT NULL AND "status" = 'active';

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_order_item_id_fkey"
  FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_ticket_type_id_fkey"
  FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_event_seat_id_fkey"
  FOREIGN KEY ("event_seat_id") REFERENCES "event_seats"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Durable receipt of every verified provider webhook, recorded before any
-- asynchronous processing. The (provider, event id) uniqueness arbitrates
-- duplicate deliveries (invariant #8).
CREATE TABLE "webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" VARCHAR(20) NOT NULL,
  "provider_event_id" VARCHAR(120) NOT NULL,
  "type" VARCHAR(120) NOT NULL,
  "payload" JSONB NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),

  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key"
  ON "webhook_events"("provider", "provider_event_id");
