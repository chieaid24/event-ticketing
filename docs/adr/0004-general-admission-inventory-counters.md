# ADR 0004: General-Admission Inventory Counters

## Status

Accepted

## Context

General-admission inventory must never oversell when holds and purchases race,
repeat, or expire. The invariant is
`reserved_quantity + sold_quantity <= capacity`, with both quantities
nonnegative, held under concurrency.

Two representations can carry that inventory. One row per admission unit mirrors
the assigned-seat model, where each seat is a row with a status. Aggregate
counters on the ticket type store reserved and sold totals instead. A
general-admission section can hold tens of thousands of units, and unlike a
seat, a unit has no identity a customer chooses, so a row per unit buys per-unit
rows without a per-unit decision to record.

## Decision

Store `reserved_quantity` and `sold_quantity` on `ticket_types`. A database
`CHECK` enforces both nonnegative and their sum within `capacity`; the
constraint is the last line of defence even if application logic is wrong.

Serialize every counter change with `SELECT ... FOR UPDATE` on the ticket-type
row. A hold that spans several types locks them in sorted id order so a create,
an expiry, and a finalization can never deadlock. Creating a hold reserves
quantity; expiry returns it exactly once, guarded by the hold status so a retry
is a no-op; finalization moves reserved to sold in one transaction. A unique
`(actor, idempotency key)` on `holds` makes a repeated create return the
original hold rather than reserve twice. Hold items persist a server-calculated
price snapshot so a later price edit cannot change a held total.

## Alternatives

One row per admission unit forces every hold and purchase to insert or update N
rows and lock N rows, and still needs an aggregate check to reason about
capacity. Its only gain, per-unit rows, is inventory the customer never selects.

Application locks or PostgreSQL advisory locks do not survive across the
separate connections and hosts that hold lanes run on, so a filesystem or
process lock is a silent no-op there. Row locks are arbitrated by the one
authority every lane shares, the database.

Redis counters would decide inventory outside PostgreSQL and break the standing
rule that PostgreSQL is authoritative for inventory.

## Consequences

A hold touches a constant number of rows regardless of quantity. The check
constraint guarantees no committed state oversells. General-admission inventory
carries no per-unit identity until ticket issuance creates one ticket per
purchased unit at finalization, which the ticket-issuance slice adds. Callers
must run these functions inside a transaction and must not reorder the ticket
type locks.

## Security impact

The server sets the price and fee snapshot on each hold item; the browser never
supplies a price, and quantity is bounded per item. An actor sees and cancels
only its own hold, so a hold identifier does not leak another customer's state.

## Operational impact

A recurring worker sweep reclaims holds past their database expiry. Checkout
re-checks database expiry on finalization, so a missed sweep delays reclaiming
reserved quantity but never grants purchase rights to an expired hold. Redis
mirrors a hold's expiry as an advisory TTL for client countdowns and never
overrides the PostgreSQL counters.
