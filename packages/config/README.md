# Configuration

`@event-ticketing/config` is the only package that reads application environment
variables. It returns parsed values to the web, API, and worker applications. It
does not load secrets from a provider or define deployment configuration.

Import `loadWebConfig`, `loadApiConfig`, or `loadWorkerConfig`. Invalid values
stop startup through a Zod validation error.

## Environment variables

| Variable                         | Default                    | Consumer    |
| -------------------------------- | -------------------------- | ----------- |
| `API_BASE_URL`                   | `http://127.0.0.1:4000`    | web         |
| `API_HOST`                       | `127.0.0.1`                | API         |
| `API_PORT`                       | `4000`                     | API         |
| `API_DEPENDENCY_TIMEOUT_MS`      | `2000`                     | API         |
| `DATABASE_URL`                   | local PostgreSQL container | API, worker |
| `LOG_LEVEL`                      | `info`                     | API, worker |
| `REDIS_URL`                      | `redis://127.0.0.1:6379`   | API, worker |
| `WORKER_SHUTDOWN_TIMEOUT_MS`     | `10000`                    | worker      |
| `WORKER_OUTBOX_BATCH_SIZE`       | `10`                       | worker      |
| `WORKER_OUTBOX_LEASE_MS`         | `30000`                    | worker      |
| `WORKER_OUTBOX_POLL_INTERVAL_MS` | `1000`                     | worker      |
| `WORKER_OUTBOX_RETRY_BASE_MS`    | `1000`                     | worker      |
| `WORKER_OUTBOX_RETRY_MAXIMUM_MS` | `300000`                   | worker      |

Invalid configuration throws `ConfigurationError`. The error names invalid
variables without copying their values into the message.

## Test

```bash
pnpm --filter @event-ticketing/config test
```

See the [system architecture](../../docs/architecture/system.md) and
[security model](../../docs/security/security-model.md).
