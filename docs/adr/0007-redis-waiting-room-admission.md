# ADR 0007: Redis Waiting-Room Admission

## Status

Accepted

## Context

A high-demand event needs to limit how many customers reach inventory mutations
at once without treating Redis as inventory authority. Queue joins can race,
clients can disconnect without leaving, admission can expire, and bearer tokens
can be altered, replayed, or presented for another event or session.

## Decision

Store one queue member per authenticated session in a Redis sorted set. Assign
the score with an atomic sequence so first join wins and a duplicate join keeps
its original position. Track heartbeats and admission leases in separate sorted
sets. Lua scripts remove expired entries and perform each join or admission as
one Redis operation.

Enable the waiting room per event in PostgreSQL. When enabled, every assigned
seat and general-admission hold requires an admission token before the existing
PostgreSQL inventory transaction runs. Redis can reduce load, but it cannot
create inventory, extend a hold, or override a PostgreSQL conflict.

Sign queue and admission tokens with HMAC-SHA-256. Bind each token to its kind,
event, authenticated session, issue time, expiry, and random nonce. A successful
admission stores its nonce in Redis until the lease expires. The first hold
attempt binds that nonce to the request's idempotency key. Retries with the same
key replay safely; a different key cannot reuse the token.

Fail closed when an enabled event loses Redis. The customer must rejoin after
queue state loss. Keep the event's waiting-room flag in PostgreSQL so Redis loss
cannot silently disable enforcement.

## Alternatives

A database queue would provide durable ordering, but high-frequency heartbeats
and status polls would add write load to the inventory authority. An unsigned
Redis cookie would be easier to issue, but a client could alter its event,
session, or expiry. A stateless admission token would survive Redis loss, but it
could not enforce a bounded lease count or reject reuse across hold attempts.

## Consequences

- Duplicate joins occupy one queue position per session.
- Admission capacity and lease duration are runtime limits shared by all
  waiting-room-enabled events.
- Queue state can disappear during Redis loss. Customers rejoin, while
  PostgreSQL inventory invariants remain unchanged.
- Admission retries require the same idempotency key. A new hold attempt
  requires a new admission.
- Operators can measure queue depth, wait time, admission rate, and endpoint
  latency without logging tokens or session identifiers.

## Security impact

Token verification uses constant-time signature comparison and checks the token
kind, event, session, and expiry. Rate limits bound joins, heartbeats, and
status polling. Logs include event-level measurements but exclude tokens,
nonces, cookies, and session identifiers.

## Operational impact

Set a random `WAITING_ROOM_TOKEN_SECRET` with at least 32 characters outside the
repository. Tune admission capacity, heartbeat expiry, lease expiry, and token
expiry through the documented environment variables. Treat a
`waiting_room.redis_unavailable` event as a fail-closed customer-impacting
condition.
