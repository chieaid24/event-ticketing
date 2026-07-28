-- General-admission inventory counters on the ticket type. Assigned types keep
-- both at zero and track state per event seat instead.
ALTER TABLE "ticket_types"
  ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sold_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ticket_types"
  ADD CONSTRAINT "ticket_types_reserved_nonnegative"
    CHECK ("reserved_quantity" >= 0),
  ADD CONSTRAINT "ticket_types_sold_nonnegative"
    CHECK ("sold_quantity" >= 0),
  -- The core oversell guard: reserved plus sold can never exceed capacity.
  -- Assigned types carry a null capacity, which leaves the check vacuously true.
  ADD CONSTRAINT "ticket_types_quantities_within_capacity"
    CHECK (
      "capacity" IS NULL
      OR "reserved_quantity" + "sold_quantity" <= "capacity"
    );

CREATE TYPE "hold_status" AS ENUM (
  'active',
  'checkout_started',
  'consumed',
  'expired',
  'cancelled'
);

CREATE TABLE "holds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "user_id" UUID,
  "guest_session_id" VARCHAR(64),
  "actor_key" VARCHAR(80) NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "status" "hold_status" NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "holds_pkey" PRIMARY KEY ("id"),
  -- A hold belongs to exactly one authenticated user or one guest session.
  CONSTRAINT "holds_one_actor" CHECK (
    ("user_id" IS NULL) <> ("guest_session_id" IS NULL)
  ),
  CONSTRAINT "holds_idempotency_key_length" CHECK (
    char_length("idempotency_key") >= 1
  )
);

-- One logical hold per (actor, idempotency key): the arbiter of duplicate
-- create requests. actor_key encodes the user or guest, so this stays a single
-- total unique index with one ON CONFLICT target.
CREATE UNIQUE INDEX "holds_actor_key_idempotency_key_key"
  ON "holds"("actor_key", "idempotency_key");

CREATE INDEX "holds_status_expires_at_idx"
  ON "holds"("status", "expires_at");

CREATE INDEX "holds_event_id_idx" ON "holds"("event_id");

ALTER TABLE "holds"
  ADD CONSTRAINT "holds_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "holds"
  ADD CONSTRAINT "holds_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hold_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hold_id" UUID NOT NULL,
  "ticket_type_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price_minor" INTEGER NOT NULL,
  "unit_fee_minor" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hold_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hold_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "hold_items_unit_price_nonnegative" CHECK ("unit_price_minor" >= 0),
  CONSTRAINT "hold_items_unit_fee_nonnegative" CHECK ("unit_fee_minor" >= 0)
);

-- One line per ticket type within a hold; quantity carries the count.
CREATE UNIQUE INDEX "hold_items_hold_id_ticket_type_id_key"
  ON "hold_items"("hold_id", "ticket_type_id");

CREATE INDEX "hold_items_ticket_type_id_idx"
  ON "hold_items"("ticket_type_id");

ALTER TABLE "hold_items"
  ADD CONSTRAINT "hold_items_hold_id_fkey"
  FOREIGN KEY ("hold_id") REFERENCES "holds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT keeps a hold item from silently vanishing if a ticket type is removed.
ALTER TABLE "hold_items"
  ADD CONSTRAINT "hold_items_ticket_type_id_fkey"
  FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
