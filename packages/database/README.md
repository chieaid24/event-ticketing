# Database

`@event-ticketing/database` owns the Prisma schema, PostgreSQL migrations,
synthetic seed data, connection lifecycle, and locking-sensitive repositories.
It does not define public API contracts or call external providers.

Import `createDatabaseClient` for a Prisma 7 client backed by the PostgreSQL
driver adapter. The factory applies finite connection timeouts and bounded pool
defaults. Import `withDatabaseConnection` when an operation owns a generic
connection lifecycle.

## Migrate and seed

Start PostgreSQL, then apply the tracked migration and synthetic seed:

```bash
pnpm services:up
pnpm db:migrate
pnpm db:seed
```

The seed upserts one `owner@example.test` user, one example organization, and
one active owner membership with stable UUIDs. It creates no usable password.
Running the seed again produces the same three logical records.

The baseline enforces normalized email, organization slug and version checks,
one membership per user and organization, explicit role and status enums, and
active-membership join timestamps.

## Integration test

```bash
pnpm test:integration
```

The runner creates a unique PostgreSQL schema and Redis key prefix, applies the
migration, runs the seed twice, verifies record counts and Redis access, then
removes both scopes. `DATABASE_URL` and `REDIS_URL` default to the local
containers.

## Test

```bash
pnpm --filter @event-ticketing/database test
```

See the [domain model](../../docs/architecture/domain-model.md) and
[inventory architecture](../../docs/architecture/inventory-and-checkout.md).
