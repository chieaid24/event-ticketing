# ADR 0005: Assigned-seat holds

## Status

Accepted

## Context

An assigned event seat is a single, individually addressable unit. Invariant #1
of [inventory and checkout](../architecture/inventory-and-checkout.md) requires
that such a seat carry at most one active hold and one sale, even when many
customers race for it, when a multi-seat request overlaps another, when a hold
expires, and when a request is retried.

[ADR 0004](0004-general-admission-inventory-counters.md) chose per-ticket-type
counters for general admission, and explicitly deferred the assigned model to a
one-row-per-seat representation. That representation now needs concrete rules
for where a seat records its hold, how expiry is decided, and how a partial
multi-seat reservation is prevented.

PostgreSQL is authoritative for inventory; Redis only accelerates client
countdowns and must never decide availability.

## Decision

Represent an assigned reservation as `event_seats.hold_id` plus one `hold_items`
row per seat.

- **The seat row is the mutex.** Creating a hold locks the requested
  `event_seats` rows with `SELECT ... FOR UPDATE`, ordered by seat id, and flips
  each to `held` with the new `hold_id` in one transaction. Because a seat is a
  single row, exactly one racing transaction can hold it; the rest observe it
  held and receive a generic conflict. Sorted-id lock order matches the create,
  expiry, and cancel paths so they cannot deadlock.
- **All or nothing.** Every requested seat must be available (or reclaimable)
  under lock before any seat is written, and the update's affected-row count
  must equal the request size. A conflicting multi-seat request reserves none of
  its seats and discloses only the unavailable seat ids.
- **Server pricing.** Each `hold_items` row snapshots the locked seat's price
  and the ticket type's fee; the browser never supplies a price.
- **Database-time expiry with reclamation.** Expiry is evaluated with
  `CURRENT_TIMESTAMP`, never application time. A create transaction may reclaim
  a seat that is `held` by a hold already past its database expiry, so a missed
  reconciliation sweep never extends purchase rights. Expiring or cancelling a
  hold frees only the seats it still holds, so a seat already reclaimed by a
  newer hold is never stolen back.
- **Shared idempotency.** Reuse the holds unique `(actor_key, idempotency_key)`
  index from ADR 0004: an insert-first `ON CONFLICT DO NOTHING` elects one hold
  and replays return the original.
- **Partial unique indexes** let both hold shapes share `hold_items`:
  `(hold_id, ticket_type_id)` where `event_seat_id IS NULL` for general
  admission, `(hold_id, event_seat_id)` where it is not null for assigned.
- **Redis is advisory.** Expiry is mirrored as a TTL key only after commit, and
  a mirror failure is swallowed; PostgreSQL alone decides availability.

Hold creation performs no external side effect and emits no outbox event;
durable events are left to the checkout, refund, and notification flows that
consume a hold.

## Alternatives

A `seat_holds` join table separate from `event_seats` was considered. It would
keep the seat row immutable, but availability would then require a join and a
second lock target, widening the deadlock surface and separating a seat's status
from its reservation. Keeping `hold_id` on the seat makes the single locked row
the whole guard.

Deciding expiry in application code was rejected because clock skew between the
API and the database could free a seat early or hold it late; the database clock
is the one authority.

A strict biconditional check tying `hold_id` non-null exactly to `held` status
was rejected because the seat-to-hold `ON DELETE SET NULL` fires during event
teardown on a still-held row; the weaker "null or held" form keeps teardown
sound while still forbidding a hold reference on an unheld seat.

## Consequences

Assigned availability is a single-row lookup and a single-row lock, which scales
with seat count and keeps the hot path narrow. Both hold kinds live in one
`hold_items` table with kind-specific partial uniqueness. Expiry and
cancellation share one seat-release path, and the existing reconciliation sweep
frees assigned seats with no new schedule. A new migration adds
`event_seats.hold_id` and `hold_items.event_seat_id`, and the general-admission
decrement paths are scoped to `event_seat_id IS NULL` so assigned lines never
move a counter.

## Security impact

The server prices every seat from the locked row, so a client cannot influence a
total. A conflict response lists only unavailable seat ids and never another
customer, hold, or actor. Idempotency is scoped per actor, so one customer's
retry key cannot read or collide with another's hold. Redis loss cannot make a
held or sold seat available because PostgreSQL is the sole authority.

## Operational impact

The 60-second `hold-expiration-sweep` already reclaims assigned seats once
`expireHold` frees them, so no new job is introduced. A Redis outage degrades
only client-facing countdowns; holds continue to commit and expire from the
database. The migration is additive (new nullable columns and indexes) and safe
to deploy before the code that writes them.
