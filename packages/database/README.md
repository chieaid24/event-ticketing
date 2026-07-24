# Database

`@event-ticketing/database` owns database lifecycle, schema, migrations, seeds,
and locking-sensitive repositories. The foundation slice exposes a connection
lifecycle boundary; the database baseline adds the PostgreSQL implementation.
This package does not define public API contracts or call external providers.

Import `DatabaseConnection` and `withDatabaseConnection` from
`@event-ticketing/database`. The helper connects before an operation and
disconnects after success or failure.

## Dependencies and configuration

The package has no external runtime dependency or configuration yet. The
database baseline will add Prisma and PostgreSQL configuration.

## Test

```bash
pnpm --filter @event-ticketing/database test
```

See the [domain model](../../docs/architecture/domain-model.md) and
[inventory architecture](../../docs/architecture/inventory-and-checkout.md).
