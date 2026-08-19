# Configuration

`@event-ticketing/config` is the only package that reads application environment
variables. It returns parsed values to the web, API, and worker applications. It
does not load secrets from a provider or define deployment configuration.

Import `loadWebConfig`, `loadApiConfig`, or `loadWorkerConfig`. Invalid values
stop startup through a Zod validation error.

## Environment variables

| Variable                             | Default                                   | Consumer    |
| ------------------------------------ | ----------------------------------------- | ----------- |
| `API_BASE_URL`                       | `http://127.0.0.1:4000`                   | web         |
| `API_COOKIE_SECURE`                  | `false`                                   | API         |
| `API_DEPENDENCY_TIMEOUT_MS`          | `2000`                                    | API         |
| `API_HOST`                           | `127.0.0.1`                               | API         |
| `API_PORT`                           | `4000`                                    | API         |
| `API_TRUSTED_ORIGINS`                | local web origins                         | API         |
| `DATABASE_URL`                       | local PostgreSQL container                | API, worker |
| `LOG_LEVEL`                          | `info`                                    | API, worker |
| `MAIL_FROM`                          | `Event Ticketing <no-reply@example.test>` | worker      |
| `OPS_ALERT_EMAIL`                    | `ops@example.test`                        | worker      |
| `PAYMENT_PROVIDER`                   | `fake`                                    | API, worker |
| `PAYMENT_WEBHOOK_SECRET`             | local-only value; see below               | API         |
| `REDIS_URL`                          | `redis://127.0.0.1:6379`                  | API, worker |
| `RESET_TOKEN_TTL_SECONDS`            | `1800`                                    | worker      |
| `SESSION_ABSOLUTE_TTL_SECONDS`       | `2592000`                                 | API         |
| `SESSION_IDLE_TTL_SECONDS`           | `86400`                                   | API         |
| `SMTP_URL`                           | `smtp://127.0.0.1:1025`                   | worker      |
| `STRIPE_PUBLISHABLE_KEY`             | none; required for stripe provider        | API         |
| `STRIPE_SECRET_KEY`                  | none; required for stripe provider        | API, worker |
| `VERIFICATION_TOKEN_TTL_SECONDS`     | `86400`                                   | worker      |
| `WAITING_ROOM_ADMISSION_CAPACITY`    | `100`                                     | API         |
| `WAITING_ROOM_HEARTBEAT_TTL_SECONDS` | `60`                                      | API         |
| `WAITING_ROOM_LEASE_TTL_SECONDS`     | `300`                                     | API         |
| `WAITING_ROOM_TOKEN_SECRET`          | local-only value; see below               | API         |
| `WAITING_ROOM_TOKEN_TTL_SECONDS`     | `1800`                                    | API         |
| `WEB_BASE_URL`                       | `http://127.0.0.1:3000`                   | worker      |
| `WORKER_OUTBOX_BATCH_SIZE`           | `10`                                      | worker      |
| `WORKER_OUTBOX_LEASE_MS`             | `30000`                                   | worker      |
| `WORKER_OUTBOX_POLL_INTERVAL_MS`     | `1000`                                    | worker      |
| `WORKER_OUTBOX_RETRY_BASE_MS`        | `1000`                                    | worker      |
| `WORKER_OUTBOX_RETRY_MAXIMUM_MS`     | `300000`                                  | worker      |
| `WORKER_SHUTDOWN_TIMEOUT_MS`         | `10000`                                   | worker      |

Invalid configuration throws `ConfigurationError`. The error names invalid
variables without copying their values into the message.

When `NODE_ENV` is `production`, `loadApiConfig` refuses to start unless
`PAYMENT_WEBHOOK_SECRET` and `WAITING_ROOM_TOKEN_SECRET` are set explicitly to
values other than the publicly known development defaults.

## Test

```bash
pnpm --filter @event-ticketing/config test
```

See the [system architecture](../../docs/architecture/system.md) and
[security model](../../docs/security/security-model.md).
