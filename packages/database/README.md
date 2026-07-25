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
companion flags.

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
deletion), and Redis isolation. It removes both scopes in a `finally` cleanup.
`DATABASE_URL` and `REDIS_URL` default to the local containers.

## Test

```bash
pnpm --filter @event-ticketing/database test
```

See the [domain model](../../docs/architecture/domain-model.md) and
[transactional outbox ADR](../../docs/adr/0002-postgresql-transactional-outbox.md).
