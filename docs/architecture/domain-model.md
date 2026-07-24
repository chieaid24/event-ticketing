# Domain Model

Use UUID primary keys, UTC `timestamptz` values, explicit enum states,
intentional foreign-key behavior, and version columns where optimistic
concurrency applies.

## Identity and tenancy

`users` store normalized email, Argon2id password hash, platform role, status,
verification, and timestamps. `sessions` store only token hashes, idle and
absolute expiry, device summaries, and revocation.

`organizations` own organizer resources. `organization_memberships` connect one
user to one organization role and status. Enforce one active membership per user
and organization.

## Venues and events

Venues contain sections, rows, and seats with labels, coordinates, access
attributes, and bounded metadata. A venue is a reusable template.

An event references one venue, lifecycle state, IANA timezone, schedule, sale
window, hold duration, refund policy, and version. Event seats snapshot relevant
venue-seat fields so later layout edits cannot corrupt sold inventory.

Ticket types represent assigned or general-admission inventory. Store price and
fees as integer minor units with an ISO 4217 currency.

## Holds and orders

A hold belongs to exactly one user or anonymous session, one event, one status,
and one authoritative database expiry. Hold items store server-calculated price
snapshots.

An order belongs to a hold and stores immutable commercial totals and item
snapshots. Payments and refunds store provider references, stable idempotency
keys, amounts, currency, status, and safe failure codes.

## Tickets and scans

Create one ticket per purchased unit. Store a public ticket number and QR token
hash, never the raw token after issuance. Scans are append-only attempts.
Check-in updates the locked ticket and adds a scan record in one transaction.

## Reliability records

- `webhook_events` deduplicate provider events.
- `outbox_events` durably request asynchronous effects.
- `idempotency_records` store actor, route, key, request hash, and safe result.
- `audit_logs` store privileged transitions without secrets.
- `notifications` track queued, sent, failed, and suppressed delivery.
- `analytics_events` and daily aggregates support organization-isolated
  reporting.

## State machines

Event states include draft, published, sales paused, postponed, cancelled,
completed, and archived. Assigned inventory is available, held, sold, or
blocked. Holds are active, checkout started, consumed, expired, or cancelled.
Orders distinguish pending, processing, paid, failure, cancellation, refunds,
and payment conflict. Tickets are active, checked in, void, or refunded.

Implement transition functions and exhaustive tests. Do not accept arbitrary
status assignment.

## Database constraints

Enforce normalized-email uniqueness, event-seat uniqueness, nonnegative prices
and quantities, unique provider events, scoped idempotency uniqueness, unique
ticket hashes, valid state-dependent fields, and:

```text
capacity >= 0
reserved_quantity >= 0
sold_quantity >= 0
reserved_quantity + sold_quantity <= capacity
```

Use database time for expiry comparisons. Persist pricing and event-seat
snapshots rather than reconstructing history from mutable configuration.
