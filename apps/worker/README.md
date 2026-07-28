# Worker

`@event-ticketing/worker` claims and processes PostgreSQL outbox events. It
hosts retryable asynchronous jobs for hold expiry, notifications, ticket
artifacts, and aggregates. It does not accept HTTP requests or decide inventory
state.

The runtime materializes due schedules, claims events with expiring leases,
executes registered handlers, and records completion receipts. It writes
structured cycle metrics without payloads or raw exception messages.

## Run

```bash
pnpm --filter @event-ticketing/worker dev
```

Set `WORKER_SHUTDOWN_TIMEOUT_MS` to bound shutdown. A graceful shutdown releases
unprocessed claims; a forced shutdown leaves leases for another worker to
recover. Configure polling with:

- `WORKER_OUTBOX_BATCH_SIZE`, default `10`
- `WORKER_OUTBOX_LEASE_MS`, default `30000`
- `WORKER_OUTBOX_POLL_INTERVAL_MS`, default `1000`
- `WORKER_OUTBOX_RETRY_BASE_MS`, default `1000`
- `WORKER_OUTBOX_RETRY_MAXIMUM_MS`, default `300000`

The worker validates these values with `DATABASE_URL`, `REDIS_URL`, and
`LOG_LEVEL` before startup. Invalid startup configuration writes one value-free
JSON failure event.

The application depends on `@event-ticketing/config` and
`@event-ticketing/database`. Register handlers in `src/handlers.ts`; handlers
that need runtime dependencies (such as the auth email handlers in
`src/auth-email-handlers.ts`) are composed in `src/main.ts`. Each provider
handler must use the event ID passed as `idempotencyKey`.

## Hold expiration sweep

On startup the worker upserts a recurring `hold.expiration.sweep` schedule that
runs every 60 seconds. The handler reclaims general-admission holds past their
database expiry, returning reserved quantity in batches of up to 500 holds per
run, one hold per transaction. The sweep is a backstop: checkout re-checks
database expiry, so a delayed sweep never lets an expired hold check out. The
handler is idempotent, so outbox redelivery only re-sweeps.

## Auth email jobs

`auth.email.verification.requested` and `auth.password.reset.requested` events
carry only a `userId`. The worker mints the single-use token itself, stores its
SHA-256 hash, and mails the plaintext link via SMTP, so secrets never appear in
outbox payloads or logs. Configure delivery with `SMTP_URL` (Mailpit locally),
`MAIL_FROM`, `WEB_BASE_URL`, `VERIFICATION_TOKEN_TTL_SECONDS`, and
`RESET_TOKEN_TTL_SECONDS`.

## Test

```bash
pnpm --filter @event-ticketing/worker test
```

See the [system architecture](../../docs/architecture/system.md) and
[dead-letter runbook](../../docs/runbooks/outbox-dead-letters.md).
