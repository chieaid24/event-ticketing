# Inventory and Checkout

These invariants are non-negotiable:

1. An assigned event seat has at most one active hold and one sale.
2. General-admission reserved plus sold quantity never exceeds capacity.
3. An expired hold cannot check out.
4. A success response follows transaction commit.
5. Redis never overrides PostgreSQL inventory.
6. The server calculates all monetary values.
7. Browser payment callbacks never mark an order paid.
8. Webhooks, checkout, refunds, ticket issuance, and scans have one logical
   effect when retried.

## Assigned-seat hold

Authenticate the actor, validate sale rules, sort seat IDs, and begin a
transaction. Resolve an existing idempotency record, lock all requested event
seat rows in stable order, and reject missing, foreign, blocked, sold, or
unexpired-held rows.

Create one hold and server-priced items. Update every seat to held with the same
hold and database-derived expiry. Require the affected-row count to match the
request. Insert outbox and idempotency records, commit, and then mirror expiry
in Redis.

Return a generic conflict with unavailable seat IDs. Never expose another
customer or hold.

## General-admission hold

Lock the ticket type, calculate capacity minus reserved and sold quantities,
reject excess demand, increment reserved quantity, and create the hold and item
in one transaction.

Expiration locks the active hold and decrements reserved quantity once. Purchase
finalization locks the hold and ticket type, moves reserved to sold, consumes
the hold, and creates tickets in one transaction.

See [ADR 0004](../adr/0004-general-admission-inventory-counters.md) for the
counter representation and locking order.

## Expiration

Use database time as authority, Redis TTL for client updates, one delayed job,
and a reconciliation sweep. New hold transactions may reclaim expired assigned
seats. Checkout always checks database expiry. A missed job cannot extend
purchase rights.

## Checkout

Lock the actor-owned hold and inventory, validate expiry, recalculate pricing,
and create or return one order per hold. Commit before creating the Stripe
PaymentIntent with a stable provider idempotency key. Store the provider
reference and return the authoritative summary and client secret.

Verify Stripe signatures against the raw body. Durably record unique webhook
events before asynchronous processing.

Successful-payment finalization locks the webhook, payment, order, hold, and
inventory. Verify provider identity, amount, currency, ownership, and allowed
grace rules. Move inventory to sold, mark the order paid, create one ticket per
unit, insert outbox events, and commit.

If payment succeeds after inventory is lost, record `PAYMENT_CONFLICT`, start an
idempotent full refund, notify the customer, and alert operations. Never
substitute seats or leave a charge without admission or compensation.

## Refunds

Accept order items and quantities, not a client amount. Lock the order and
items, apply the event policy, calculate the value, and create one pending
refund. Stripe webhook processing finalizes state, voids tickets, and applies
the explicit inventory-return policy.

Do not return inventory after event start. Before the configured cutoff, an
assigned seat may return to available and general-admission sold quantity may
decrease.
