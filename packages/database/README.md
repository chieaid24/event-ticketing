# Database

`@event-ticketing/database` owns the Prisma schema, PostgreSQL migrations,
synthetic seed data, connection lifecycle, and locking-sensitive repositories.
It does not define public API contracts or call external providers.

Import `createDatabaseClient` for a Prisma 7 client backed by the PostgreSQL
driver adapter. The factory applies finite connection timeouts and bounded pool
defaults. Import `withDatabaseConnection` when an operation owns a generic
connection lifecycle.

Import `createDatabasePool` and `withDatabaseTransaction` for raw,
locking-sensitive repositories. Call `enqueueOutboxEvent` with the active
transaction to commit domain state and asynchronous work atomically. Create an
`OutboxRepository` for worker claims, retries, schedules, completion receipts,
and metrics.

Import `createGeneralAdmissionHold`, `expireHold`, `expireDueHolds`,
`finalizeGeneralAdmissionHold`, `cancelHold`, and
`fetchGeneralAdmissionAvailability` for general-admission inventory held on
locked ticket-type counters. Import `createAssignedSeatHold` for specific seats
reserved under per-seat row locks in sorted id order; it prices each seat from
the locked row, holds all requested seats or none, may reclaim a seat whose hold
has expired by database time, and raises `SeatsUnavailableError` carrying only
the unavailable seat ids. Run them inside a transaction; they lock in sorted id
order. Import `mirrorHoldExpiry`, `clearHoldExpiry`, and `readHoldExpiry` to
advise Redis of a hold's expiry without ceding inventory authority to it.

## Migrate and seed

Start PostgreSQL, then apply the tracked migration and synthetic seed:

```bash
pnpm services:up
pnpm db:migrate
pnpm db:seed
```

The seed upserts one `owner@example.test` user (development password
`owner-password-dev`), one example organization, one active owner membership,
and one venue template with an assigned section, a general-admission section,
two rows, and eight seats, all with stable UUIDs.

The migrations enforce normalized email, organization slug and version checks,
one membership per user and organization, explicit role and status enums,
active-membership join timestamps, outbox state-dependent fields, and venue
layout rules: unique names and labels per scope, bounded coordinates,
kind-dependent general-admission capacity, and mutually exclusive accessible and
companion flags. Event tables enforce positive versions, bounded hold duration,
supported currencies, kind-dependent ticket-type capacity, unique event-seat
positions, and a publication timestamp that matches event status. A published
event cannot delete its venue because the venue foreign key restricts it.
General-admission holds enforce nonnegative reserved and sold quantities within
capacity, exactly one hold actor per hold, and a positive hold-item quantity.
Assigned-seat holds link each held seat to its hold, permit that link only while
the seat is held, and keep at most one hold item per seat within a hold.

The seed transaction upserts sixteen domain records and one deduplicated
`organization.created` event. Running it again preserves the same seventeen
logical records.

## Integration test

```bash
pnpm test:integration
```

The runner creates a unique PostgreSQL schema and Redis key prefix, applies
migrations, and runs the seed twice. It verifies atomic rollback and commit,
concurrent `SKIP LOCKED` claims, delayed work, bounded dead-letter transitions,
lease recovery, graceful claim release, durable receipts, schedule
materialization, metrics, venue layout replacement (version compare-and-swap
under concurrency, organization scoping, constraint rejection, cascade
deletion), event publishing (draft version compare-and-swap, assigned-seat
snapshot, audit and outbox effects, and transaction rollback), general-admission
holds (no oversell under concurrent reservation, reserved and sold bounds,
single-decrement expiry, reserved-to-sold finalization, idempotent create, and
the Redis expiry mirror), and Redis isolation. It removes both scopes in a
`finally` cleanup. `DATABASE_URL` and `REDIS_URL` default to the local
containers.

## Test

```bash
pnpm --filter @event-ticketing/database test
```

See the [domain model](../../docs/architecture/domain-model.md), the
[transactional outbox ADR](../../docs/adr/0002-postgresql-transactional-outbox.md),
and the
[general-admission inventory ADR](../../docs/adr/0004-general-admission-inventory-counters.md).
