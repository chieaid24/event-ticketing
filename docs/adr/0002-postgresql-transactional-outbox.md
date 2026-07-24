# ADR 0002: PostgreSQL Transactional Outbox

## Status

Accepted

## Context

The API must commit domain state and requests for asynchronous work without a
gap between two systems. A database commit followed by a Redis or provider call
can lose work if the process stops between those operations. Publishing first
can expose work whose domain transaction later rolls back.

Workers also need bounded retries, delayed delivery, recurring schedules, and
operator-visible failures. PostgreSQL already owns the domain transaction and
must remain authoritative when Redis is unavailable.

## Decision

Store outbox events in PostgreSQL and insert them through the same transaction
that changes domain state. Set `available_at` to delay an event. Materialize
recurring schedules into uniquely keyed outbox events.

Workers claim due events with `FOR UPDATE SKIP LOCKED`. Each claim records a
worker identifier, increments the bounded attempt count, and sets a lease
deadline. A graceful shutdown releases remaining claims. An interrupted worker
leaves leases that another worker can claim after expiry.

Use at-least-once delivery. Retry failures with bounded exponential delays and
move the final failure to `dead_letter`. Record only stable error codes. Store a
durable handler receipt before marking an event complete, and skip the handler
when a receipt already exists. Pass the event ID to handlers as their
idempotency key. Provider handlers must use that key because a process can stop
after a provider accepts a request but before PostgreSQL records the receipt.

Expose ready, delayed, processing, retry, dead-letter, and oldest-ready counts
in structured worker cycle logs. Use the
[dead-letter runbook](../runbooks/outbox-dead-letters.md) for inspection and
redelivery.

## Alternatives

Publishing directly to BullMQ after a domain commit leaves a failure window and
makes Redis loss capable of losing required work.

Polling domain tables couples each worker to unrelated domain state and cannot
represent generic delayed or recurring work without repeating queue logic.

PostgreSQL `LISTEN` and `NOTIFY` can reduce wake-up latency, but notifications
are not durable. They may be added as a wake-up hint while the outbox remains
authoritative.

## Consequences

Applications that create asynchronous work must share a PostgreSQL transaction
with `enqueueOutboxEvent`. Workers may receive an event more than once, so every
handler must make its effects idempotent.

The outbox adds write volume and retained rows. Operators must monitor queue age
and dead letters, then apply a retention policy after event-volume data exists.
Recurring schedules advance one interval per materialization pass, so missed
runs remain visible and catch up in order.

## Security impact

Outbox payloads are durable database records and must not contain credentials,
raw tokens, payment payloads, or unnecessary personal data. Worker logs include
aggregate counts and stable cycle error codes, but never payloads or raw
exception messages. Operators inspect event IDs, topics, and handler error codes
inside PostgreSQL.

## Operational impact

PostgreSQL availability gates enqueue and delivery. Redis loss does not discard
outbox work. Operators inspect and redeliver failed events with the documented
transactional procedure. Lease expiry recovers work after forced shutdown.
