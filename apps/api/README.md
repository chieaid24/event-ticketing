# API

`@event-ticketing/api` is the HTTP boundary for trusted platform decisions. It
owns authentication and will own authorization, inventory, orders, payments,
tickets, and administration. It does not render pages or run asynchronous jobs.

`GET /status` returns the shared `StatusResponse` contract. `GET /health/live`
reports process liveness without checking dependencies. `GET /health/ready`
checks PostgreSQL and Redis within `API_DEPENDENCY_TIMEOUT_MS` and returns `503`
when either dependency is unavailable.

## Authentication routes

All bodies are validated with the shared Zod contracts and errors use the
`{ code, message }` contract. Sessions are opaque cookie secrets stored only as
hashes; see [ADR 0003](../../docs/adr/0003-database-backed-opaque-sessions.md).

- `POST /auth/register` accepts email and password, always answers `202`, and
  enqueues a verification email for new or still-pending accounts.
- `POST /auth/verify-email` consumes a single-use token and activates the
  account.
- `POST /auth/login` verifies Argon2id credentials, requires a verified account,
  and sets the `et_session` (HttpOnly) and `et_csrf` cookies.
- `GET /auth/me` returns the current user and refreshes session idle expiry.
- `POST /auth/logout` revokes the current session. CSRF protected.
- `POST /auth/forgot-password` always answers `202` and enqueues a reset email
  for active accounts.
- `POST /auth/reset-password` consumes a single-use token, updates the password,
  and revokes every session.
- `POST /auth/change-password` verifies the current password, revokes every
  session, and rotates the caller onto a fresh one. CSRF protected.
- `GET /auth/sessions` lists active sessions with the current one flagged.
- `DELETE /auth/sessions/:id` revokes one session. CSRF protected.

Mutating cookie routes require the `x-csrf-token` header matching the session
and reject untrusted `Origin` values from `API_TRUSTED_ORIGINS`. Sensitive
routes are rate limited per client through Redis and fail open when Redis is
unavailable. Session expiry uses `SESSION_IDLE_TTL_SECONDS` and
`SESSION_ABSOLUTE_TTL_SECONDS`; cookie security uses `API_COOKIE_SECURE`.

## Organization routes

Role permissions follow the
[authorization policy](../../docs/security/authorization.md). Every route
requires an active membership in the addressed organization; non-members get the
same `404` as a missing organization. Mutations are CSRF protected.

- `POST /organizations` creates an organization with the caller as owner.
- `GET /organizations` lists memberships and pending invitations.
- `POST /organizations/invitations/:id/accept` and `.../decline` answer an
  invitation addressed to the session user.
- `GET /organizations/:id` returns the organization plus the caller's role,
  permissions, and assignable roles.
- `PATCH /organizations/:id` renames it with optimistic `version` checking.
- `DELETE /organizations/:id` is owner-only and requires the slug retyped.
- `GET /organizations/:id/members`, `POST .../members` (invite),
  `PATCH .../members/:membershipId` (role change with `expectedRole`), and
  `DELETE .../members/:membershipId` (remove, or leave when addressing your own
  membership) manage the roster under last-owner protection.
- `GET /organizations/:id/audit-logs` lists privileged changes for owners and
  admins.

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
