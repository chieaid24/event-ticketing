CREATE TYPE "event_status" AS ENUM (
  'draft',
  'published',
  'sales_paused',
  'postponed',
  'cancelled',
  'completed',
  'archived'
);

CREATE TYPE "ticket_type_kind" AS ENUM ('assigned', 'general_admission');

CREATE TYPE "event_seat_status" AS ENUM (
  'available',
  'held',
  'sold',
  'blocked'
);

CREATE TABLE "events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "venue_id" UUID NOT NULL,
  "title" VARCHAR(140) NOT NULL,
  "description" VARCHAR(2000),
  "status" "event_status" NOT NULL DEFAULT 'draft',
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "sales_start_at" TIMESTAMPTZ(6),
  "sales_end_at" TIMESTAMPTZ(6),
  "hold_duration_seconds" INTEGER NOT NULL DEFAULT 600,
  "refund_policy" VARCHAR(2000),
  "media_url" VARCHAR(2048),
  "published_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "events_title_length" CHECK (char_length("title") >= 3),
  CONSTRAINT "events_version_positive" CHECK ("version" > 0),
  CONSTRAINT "events_hold_duration_bounded" CHECK (
    "hold_duration_seconds" BETWEEN 60 AND 86400
  ),
  CONSTRAINT "events_currency_supported" CHECK (
    "currency" IN ('USD', 'CAD', 'EUR', 'GBP', 'AUD')
  ),
  -- A published event has a publication timestamp; a draft has none.
  CONSTRAINT "events_published_at_matches_status" CHECK (
    ("status" = 'draft' AND "published_at" IS NULL)
    OR ("status" <> 'draft' AND "published_at" IS NOT NULL)
  )
);

CREATE INDEX "events_organization_id_status_idx"
  ON "events"("organization_id", "status");

ALTER TABLE "events"
  ADD CONSTRAINT "events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT protects snapshotted inventory: a venue with events cannot be deleted.
ALTER TABLE "events"
  ADD CONSTRAINT "events_venue_id_fkey"
  FOREIGN KEY ("venue_id") REFERENCES "venues"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ticket_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "kind" "ticket_type_kind" NOT NULL,
  "section_name" VARCHAR(80) NOT NULL,
  "price_minor" INTEGER NOT NULL,
  "fee_minor" INTEGER NOT NULL DEFAULT 0,
  "capacity" INTEGER,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_types_name_length" CHECK (char_length("name") >= 1),
  CONSTRAINT "ticket_types_position_nonnegative" CHECK ("position" >= 0),
  CONSTRAINT "ticket_types_price_nonnegative" CHECK ("price_minor" >= 0),
  CONSTRAINT "ticket_types_fee_nonnegative" CHECK ("fee_minor" >= 0),
  -- General admission carries a bounded capacity; assigned draws seats from the
  -- venue layout and carries none.
  CONSTRAINT "ticket_types_kind_capacity" CHECK (
    (
      "kind" = 'general_admission'
      AND "capacity" BETWEEN 1 AND 100000
    )
    OR ("kind" = 'assigned' AND "capacity" IS NULL)
  )
);

CREATE UNIQUE INDEX "ticket_types_event_id_name_key"
  ON "ticket_types"("event_id", "name");

ALTER TABLE "ticket_types"
  ADD CONSTRAINT "ticket_types_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "event_seats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "ticket_type_id" UUID NOT NULL,
  "section_name" VARCHAR(80) NOT NULL,
  "row_label" VARCHAR(12) NOT NULL,
  "seat_label" VARCHAR(12) NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "accessible" BOOLEAN NOT NULL DEFAULT false,
  "companion" BOOLEAN NOT NULL DEFAULT false,
  "price_minor" INTEGER NOT NULL,
  "status" "event_seat_status" NOT NULL DEFAULT 'available',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_seats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_seats_coordinates_bounded" CHECK (
    "x" BETWEEN 0 AND 1000 AND "y" BETWEEN 0 AND 1000
  ),
  CONSTRAINT "event_seats_price_nonnegative" CHECK ("price_minor" >= 0),
  -- A seat is accessible or a companion seat, never both.
  CONSTRAINT "event_seats_access_roles_exclusive" CHECK (
    NOT ("accessible" AND "companion")
  )
);

CREATE UNIQUE INDEX "event_seats_event_id_seat_key"
  ON "event_seats"("event_id", "section_name", "row_label", "seat_label");

CREATE INDEX "event_seats_event_id_status_idx"
  ON "event_seats"("event_id", "status");

ALTER TABLE "event_seats"
  ADD CONSTRAINT "event_seats_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "event_seats"
  ADD CONSTRAINT "event_seats_ticket_type_id_fkey"
  FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
