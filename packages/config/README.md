# Configuration

`@event-ticketing/config` is the only package that reads application environment
variables. It returns parsed values to the web, API, and worker applications. It
does not load secrets from a provider or define deployment configuration.

Import `loadWebConfig`, `loadApiConfig`, or `loadWorkerConfig`. Invalid values
stop startup through a Zod validation error.

## Environment variables

| Variable                     | Default                 | Consumer |
| ---------------------------- | ----------------------- | -------- |
| `API_BASE_URL`               | `http://127.0.0.1:4000` | web      |
| `API_HOST`                   | `127.0.0.1`             | API      |
| `API_PORT`                   | `4000`                  | API      |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `10000`                 | worker   |

## Test

```bash
pnpm --filter @event-ticketing/config test
```

See the [system architecture](../../docs/architecture/system.md) and
[security model](../../docs/security/security-model.md).
