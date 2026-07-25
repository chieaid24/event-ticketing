CREATE TYPE "venue_section_kind" AS ENUM ('assigned', 'general_admission');

CREATE TABLE "venues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(400),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venues_name_length" CHECK (char_length("name") >= 3),
  CONSTRAINT "venues_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "venues_organization_id_name_key"
  ON "venues"("organization_id", "name");

ALTER TABLE "venues"
  ADD CONSTRAINT "venues_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "venue_sections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "venue_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "kind" "venue_section_kind" NOT NULL,
  "ga_capacity" INTEGER,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_sections_name_length" CHECK (char_length("name") >= 1),
  CONSTRAINT "venue_sections_position_nonnegative" CHECK ("position" >= 0),
  -- General admission carries a bounded capacity; assigned carries none.
  CONSTRAINT "venue_sections_kind_capacity" CHECK (
    (
      "kind" = 'general_admission'
      AND "ga_capacity" BETWEEN 1 AND 100000
    )
    OR ("kind" = 'assigned' AND "ga_capacity" IS NULL)
  )
);

CREATE UNIQUE INDEX "venue_sections_venue_id_name_key"
  ON "venue_sections"("venue_id", "name");

ALTER TABLE "venue_sections"
  ADD CONSTRAINT "venue_sections_venue_id_fkey"
  FOREIGN KEY ("venue_id") REFERENCES "venues"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "venue_rows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "section_id" UUID NOT NULL,
  "label" VARCHAR(12) NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_rows_label_length" CHECK (char_length("label") >= 1),
  CONSTRAINT "venue_rows_position_nonnegative" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "venue_rows_section_id_label_key"
  ON "venue_rows"("section_id", "label");

ALTER TABLE "venue_rows"
  ADD CONSTRAINT "venue_rows_section_id_fkey"
  FOREIGN KEY ("section_id") REFERENCES "venue_sections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "venue_seats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "row_id" UUID NOT NULL,
  "label" VARCHAR(12) NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "accessible" BOOLEAN NOT NULL DEFAULT false,
  "companion" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_seats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "venue_seats_label_length" CHECK (char_length("label") >= 1),
  CONSTRAINT "venue_seats_coordinates_bounded" CHECK (
    "x" BETWEEN 0 AND 1000 AND "y" BETWEEN 0 AND 1000
  ),
  -- A seat is accessible or a companion seat, never both.
  CONSTRAINT "venue_seats_access_roles_exclusive" CHECK (
    NOT ("accessible" AND "companion")
  )
);

CREATE UNIQUE INDEX "venue_seats_row_id_label_key"
  ON "venue_seats"("row_id", "label");

ALTER TABLE "venue_seats"
  ADD CONSTRAINT "venue_seats_row_id_fkey"
  FOREIGN KEY ("row_id") REFERENCES "venue_rows"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
