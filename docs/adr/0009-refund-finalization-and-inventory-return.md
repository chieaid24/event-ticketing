# ADR 0009: Refund Finalization and Inventory Return

## Status

Accepted

## Context

A refund crosses the API, database, payment provider, webhook receiver, worker,
ticket inventory, and notification system. Provider calls cannot share a
database transaction, and duplicate customer requests, worker deliveries, or
webhooks must not create extra money movement.

Refunded admission must stop scanning immediately after finalization. Returning
inventory is a separate commercial choice: near or after event start, resale is
unsafe even though the customer still receives money.

## Decision

The API accepts order item IDs and quantities, locks the paid order, and
calculates the target from immutable price and fee snapshots. Requested,
provider-pending, and completed refund items all reduce the remaining eligible
quantity. `(order_id, request_key)` identifies one logical request.

The worker calls the provider outside a database transaction with
`refund:<refund_id>` as the provider idempotency key. Stripe refunds remain
provider-pending until a signed `refund.updated` event reports success. The fake
provider settles through the same finalization path.

Finalization verifies the refund ID, provider reference, amount, and currency,
then locks the refund, order items, tickets, and inventory in one transaction.
It records success, marks active or checked-in tickets refunded, and returns
inventory only when database time is before both event start and the event's
inventory return cutoff. A duplicate finalization observes the completed refund
and makes no further changes.

A signed terminal failure verifies the same stored target before marking the
request failed. Failed refund items no longer reduce the remaining eligible
quantity, so a new request can retry them under a new idempotency key.

## Alternatives

- Finalize from the provider API response. Rejected because an interrupted
  response cannot prove whether the provider committed the refund.
- Trust a client-supplied amount. Rejected because the server owns price, fees,
  refunded quantities, and policy.
- Always return inventory. Rejected because tickets refunded near or after event
  start must not become newly sellable.
- Hold a database transaction open during the provider call. Rejected because
  external latency would extend locks and still would not make both systems
  atomic.

## Consequences

- A provider outage leaves a durable refund request that the worker can retry.
- Duplicate requests, provider calls, and webhooks converge on one refund.
- Tickets become non-scannable in the same transaction that records success.
- Organizers control the customer cutoff and the separate inventory return
  cutoff per event.
- Operations must monitor provider-pending refunds and refund webhook lag.

## Security impact

Customer routes scope orders to the authenticated actor. Organizer routes need
`finance.manage`, organization ownership of the order, and an operator reason.
Provider events pass signature verification and exact stored-target checks
before money state or inventory changes.

## Operational impact

Refund requests and provider events use the transactional outbox. Operators can
diagnose pending refunds from safe identifiers and timestamps, then replay
provider webhooks without editing refund, ticket, or inventory records.
