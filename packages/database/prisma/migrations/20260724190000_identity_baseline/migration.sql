CREATE TYPE "platform_role" AS ENUM ('customer', 'admin');
CREATE TYPE "user_status" AS ENUM ('pending', 'active', 'suspended', 'disabled');
CREATE TYPE "membership_role" AS ENUM (
  'owner',
  'admin',
  'event_manager',
  'finance',
  'scanner',
  'viewer'
);
CREATE TYPE "membership_status" AS ENUM ('invited', 'active', 'removed');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "password_hash" VARCHAR(255),
  "platform_role" "platform_role" NOT NULL DEFAULT 'customer',
  "status" "user_status" NOT NULL DEFAULT 'pending',
  "email_verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email_normalized" CHECK ("email" = lower("email"))
);

CREATE TABLE "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organizations_version_positive" CHECK ("version" > 0),
  CONSTRAINT "organizations_slug_format" CHECK (
    "slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE TABLE "organization_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "membership_role" NOT NULL,
  "status" "membership_status" NOT NULL DEFAULT 'invited',
  "invited_by_id" UUID,
  "joined_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_memberships_joined_state" CHECK (
    ("status" = 'active' AND "joined_at" IS NOT NULL)
    OR ("status" <> 'active')
  )
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key"
  ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX "organization_memberships_user_id_status_idx"
  ON "organization_memberships"("user_id", "status");

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_invited_by_id_fkey"
  FOREIGN KEY ("invited_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
