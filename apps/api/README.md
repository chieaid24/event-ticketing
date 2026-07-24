# API

`@event-ticketing/api` is the HTTP boundary for trusted platform decisions. It
will own authentication, authorization, inventory, orders, payments, tickets,
and administration. It does not render pages or run asynchronous jobs.

The current public entry point is `GET /status`, which returns the shared
`StatusResponse` contract.

## Run

```bash
pnpm --filter @event-ticketing/api dev
curl http://127.0.0.1:4000/status
```

Set `API_HOST` or `API_PORT` to change the listener. The application depends on
`@event-ticketing/config` and `@event-ticketing/contracts`.

## Test

```bash
pnpm --filter @event-ticketing/api test
```

See the [system architecture](../../docs/architecture/system.md) and
[security model](../../docs/security/security-model.md).
