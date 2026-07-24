# API

`@event-ticketing/api` is the HTTP boundary for trusted platform decisions. It
will own authentication, authorization, inventory, orders, payments, tickets,
and administration. It does not render pages or run asynchronous jobs.

`GET /status` returns the shared `StatusResponse` contract. `GET /health/live`
reports process liveness without checking dependencies. `GET /health/ready`
checks PostgreSQL and Redis within `API_DEPENDENCY_TIMEOUT_MS` and returns `503`
when either dependency is unavailable.

## Run

```bash
pnpm --filter @event-ticketing/api dev
curl http://127.0.0.1:4000/status
curl http://127.0.0.1:4000/health/ready
```

Set `API_HOST` or `API_PORT` to change the listener. Set `DATABASE_URL`,
`REDIS_URL`, `API_DEPENDENCY_TIMEOUT_MS`, or `LOG_LEVEL` to change runtime
dependencies. The application validates all values before listening.

Every response includes `x-request-id`. The API accepts a bounded, printable
request ID or creates a UUID, then logs the method, path, status, duration, and
request ID as JSON. It does not log headers, query strings, or dependency
errors.

The application depends on `@event-ticketing/config`,
`@event-ticketing/contracts`, `@event-ticketing/database`, PostgreSQL, and
Redis. It does not require Mailpit or MinIO for current routes.

## Test

```bash
pnpm --filter @event-ticketing/api test
```

See the [system architecture](../../docs/architecture/system.md) and
[security model](../../docs/security/security-model.md).
