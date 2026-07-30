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

Create one hold and server-priced items, one item per seat. Update every seat to
held with the same hold and database-derived expiry, and store that hold on the
seat so a later transaction can find and reclaim it. Require the affected-row
count to match the request. Record the idempotency claim through the unique
actor-and-key index and commit, then mirror expiry in Redis. Hold creation
performs no external side effect, so it emits no outbox event; durable events
follow from the checkout, refund, and notification flows that consume a hold.

A new hold transaction may reclaim a held seat whose hold has already expired by
database time, so a missed expiry sweep never grants purchase rights. Expiring
or cancelling a hold frees only the seats it still holds; a seat reclaimed by a
newer hold is left untouched.

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

A hold that starts checkout keeps its inventory for a payment grace window
beyond expiry before the sweep frees it, covering provider processing and
webhook delivery. A payment that succeeds later still finalizes when every unit
is reattachable; otherwise the conflict path compensates.

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

## Waiting room

An organizer can enable the waiting room on a draft event. Authenticated
customers join one Redis sorted-set position per session, maintain it with a
heartbeat, and poll the status route. Atomic Lua scripts admit the oldest live
entries while the event's active lease count remains below the configured
capacity.

Queue tokens bind the event and session to a short expiry. Admission tokens add
a single-use nonce and an admission lease. A hold request consumes that nonce
under its idempotency key, so a network retry can replay the same hold request
but cannot spend the admission on a different request.

Both hold routes check waiting-room admission before entering the existing
inventory transaction. PostgreSQL still locks and validates every seat or
general-admission counter. Redis loss fails admission closed for enabled events;
it never makes inventory available or changes a committed hold.

See [ADR 0007](../adr/0007-redis-waiting-room-admission.md) for queue ordering,
token, lease, and failure decisions.

## Refunds

Accept order item IDs and quantities, not a client amount. Lock the order,
subtract quantities in requested, provider-pending, and completed refunds, apply
the event policy, and calculate the value from stored price and fee snapshots.
The `(order_id, request_key)` constraint makes retries one logical refund.

Customers may request refunds only when the event enables them and database time
is before the configured customer cutoff. Organization members with
`finance.manage` may request a refund later with an operator reason.

The worker calls the provider outside the database transaction with
`refund:<refund_id>` as the provider idempotency key. A signed provider webhook
finalizes the refund only after its refund ID, provider reference, amount, and
currency match the stored target. A verified terminal provider failure releases
the requested quantities for a later retry. Successful finalization locks the
affected records, marks tickets refunded, and applies inventory changes once.
See [ADR 0009](../adr/0009-refund-finalization-and-inventory-return.md).

Return inventory only before both event start and the configured inventory
cutoff. A later refund still voids the ticket but leaves assigned inventory sold
and general-admission sold quantity unchanged.

Each confirmation, reminder, refund, or cancellation delivery has one
notification record and one outbox event. Transient delivery failures retry;
invalid addresses and permanent provider failures become suppressed.
