-- Assigned-seat holds: link each held seat to the hold reserving it, and let a
-- hold item reference the specific event seat whose price it snapshots.

-- The hold currently reserving a seat. Only set while the seat is held; freeing
-- the seat clears it. A single seat row is the whole guard for "at most one
-- active hold per seat" (invariant #1): status and hold_id move together under a
-- row lock.
ALTER TABLE "event_seats"
  ADD COLUMN "hold_id" UUID;

-- A seat may point at a hold only while held. The weaker (null-or-held) form,
-- rather than a strict biconditional, keeps event teardown from failing when the
-- SET NULL below fires on a still-held row that is about to be deleted anyway.
ALTER TABLE "event_seats"
  ADD CONSTRAINT "event_seats_hold_requires_held"
    CHECK ("hold_id" IS NULL OR "status" = 'held');

CREATE INDEX "event_seats_hold_id_idx" ON "event_seats"("hold_id");

-- SET NULL so cascading an event delete (which removes its holds and its seats)
-- never trips this link; the seat row is then removed by its own event cascade.
ALTER TABLE "event_seats"
  ADD CONSTRAINT "event_seats_hold_id_fkey"
  FOREIGN KEY ("hold_id") REFERENCES "holds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- One hold item per seat for an assigned hold; the priced snapshot lives here.
ALTER TABLE "hold_items"
  ADD COLUMN "event_seat_id" UUID;

-- Assigned lines carry exactly one seat at quantity one; general-admission lines
-- carry a null seat and a positive quantity.
ALTER TABLE "hold_items"
  ADD CONSTRAINT "hold_items_assigned_single_seat"
    CHECK ("event_seat_id" IS NULL OR "quantity" = 1);

-- RESTRICT mirrors the ticket-type link: a live hold item must not silently lose
-- the event seat it references.
ALTER TABLE "hold_items"
  ADD CONSTRAINT "hold_items_event_seat_id_fkey"
  FOREIGN KEY ("event_seat_id") REFERENCES "event_seats"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "hold_items_event_seat_id_idx" ON "hold_items"("event_seat_id");
CREATE INDEX "hold_items_hold_id_idx" ON "hold_items"("hold_id");

-- Replace the total (hold, ticket type) uniqueness with kind-specific partial
-- indexes so both hold shapes coexist: general admission stays one row per
-- ticket type; assigned becomes one row per seat within a hold.
DROP INDEX "hold_items_hold_id_ticket_type_id_key";

CREATE UNIQUE INDEX "hold_items_hold_ticket_type_ga_key"
  ON "hold_items"("hold_id", "ticket_type_id")
  WHERE "event_seat_id" IS NULL;

CREATE UNIQUE INDEX "hold_items_hold_seat_key"
  ON "hold_items"("hold_id", "event_seat_id")
  WHERE "event_seat_id" IS NOT NULL;
