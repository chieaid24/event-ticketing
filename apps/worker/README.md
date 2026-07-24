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

Set `WORKER_SHUTDOWN_TIMEOUT_MS` to bound shutdown. The application depends on
`@event-ticketing/config`.

## Test

```bash
pnpm --filter @event-ticketing/worker test
```

See the [system architecture](../../docs/architecture/system.md) and
[runbook index](../../docs/operations/runbook-index.md).
