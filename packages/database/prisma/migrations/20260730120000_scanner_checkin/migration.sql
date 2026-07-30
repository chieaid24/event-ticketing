-- Scanner check-in: widen the ticket lifecycle and record every validation
-- attempt in an append-only scan history.

-- New values are only added here; no statement in this migration references
-- them, which PostgreSQL requires inside a transaction block.
ALTER TYPE "ticket_status" ADD VALUE IF NOT EXISTS 'checked_in';
ALTER TYPE "ticket_status" ADD VALUE IF NOT EXISTS 'refunded';

-- Current check-in state; the scan history keeps the full record.
ALTER TABLE "tickets" ADD COLUMN "checked_in_at" TIMESTAMPTZ(6);

CREATE TYPE "scan_result" AS ENUM (
  'accepted',
  'duplicate',
  'wrong_event',
  'refunded',
  'void',
  'expired',
  'invalid',
  'reversed'
);

-- Append-only: rows are inserted and never updated or deleted. ticket_id is
-- null when the credential matched no ticket visible to the organization.
-- actor_user_id survives user deletion via SET NULL, like audit_logs.
CREATE TABLE "scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_id" UUID,
    "actor_user_id" UUID,
    "device_id" VARCHAR(64) NOT NULL,
    "result" "scan_result" NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scans_event_created_idx"
  ON "scans"("event_id", "created_at" DESC);

CREATE INDEX "scans_ticket_created_idx"
  ON "scans"("ticket_id", "created_at" DESC);

ALTER TABLE "scans"
  ADD CONSTRAINT "scans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scans"
  ADD CONSTRAINT "scans_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scans"
  ADD CONSTRAINT "scans_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "scans"
  ADD CONSTRAINT "scans_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
