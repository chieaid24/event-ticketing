# Worker

`@event-ticketing/worker` hosts retryable asynchronous jobs. It will process
hold expiry, outbox delivery, notifications, ticket artifacts, and aggregates.
It does not accept HTTP requests or decide inventory state.

The foundation runtime starts as a long-lived process, writes structured startup
and shutdown events, and handles `SIGINT` and `SIGTERM`.

## Run

```bash
pnpm --filter @event-ticketing/worker dev
```

Set `WORKER_SHUTDOWN_TIMEOUT_MS` to bound shutdown. The worker also validates
`DATABASE_URL`, `REDIS_URL`, and `LOG_LEVEL` before it starts. Invalid startup
configuration writes one value-free JSON failure event.

The application depends on `@event-ticketing/config`. Database and queue
connections land with their owning worker features.

## Test

```bash
pnpm --filter @event-ticketing/worker test
```

See the [system architecture](../../docs/architecture/system.md) and
[runbook index](../../docs/operations/runbook-index.md).
