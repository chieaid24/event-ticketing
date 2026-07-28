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

## Venue routes

Venue templates are organization scoped under
`/organizations/:organizationId/venues`. Reads need an active membership;
mutations need the `venues.manage` permission and CSRF. A venue addressed
through the wrong organization answers the same `404` as a missing venue.

- `POST .../venues` creates an empty template; duplicate names answer
  `venue_name_taken`.
- `GET .../venues` lists templates with section, seat, accessible-seat, and
  general-admission counts.
- `GET .../venues/:venueId` returns the template and its full layout document.
- `PATCH .../venues/:venueId` updates name and description with optimistic
  `version` checking.
- `PUT .../venues/:venueId/layout` validates the shared layout contract plus the
  semantic rules in `validateVenueLayout` (duplicate labels, shared coordinates,
  companion adjacency, seat cap) and replaces the whole layout atomically under
  the same `version` check.
- `DELETE .../venues/:venueId` removes the template and cascades its layout.

Venue mutations write `venue.created`, `venue.updated`, `venue.layout.replaced`,
and `venue.deleted` audit entries.

## Event routes

Events are organization scoped under `/organizations/:organizationId/events`.
Reads need an active membership; mutations need the `events.manage` permission
and CSRF. Only a draft accepts edits; a non-draft answers `event_not_draft`. An
event addressed through the wrong organization answers the same `404` as a
missing event.

- `POST .../events` drafts an event against an existing venue. An unknown venue
  answers `venue_not_found`.
- `GET .../events` lists events with venue name, start time, ticket-type count,
  and materialized capacity.
- `GET .../events/:eventId` returns the event, its ticket types, the venue
  sections available to sell, and the outstanding publication problems.
- `PATCH .../events/:eventId` saves draft basics (title, description, timezone,
  currency, schedule, sale window, hold duration, refund policy, media) under
  optimistic `version` checking; a stale save answers `version_conflict`.
- `PUT .../events/:eventId/ticket-types` replaces the ticket-type set under the
  same `version` check. Each type must match a venue section of its kind, or the
  request answers `ticket_types_invalid`.
- `POST .../events/:eventId/publish` runs `validateEventForPublication` and
  answers `422 event_incomplete` when the event is incomplete or inconsistent.
  On success it snapshots each assigned section's seats into `event_seats`,
  marks the event published, writes an audit entry, and enqueues an
  `event.published` outbox event, all in one transaction.

Money is stored as integer minor units with an ISO 4217 currency; times are UTC
instants paired with the event's IANA timezone. Event mutations write
`event.created`, `event.updated`, `event.ticket_types.replaced`, and
`event.published` audit entries.

## Hold routes

Hold routes reserve inventory for the authenticated actor. They require a
session and, as mutations, the `x-csrf-token` header and a trusted origin, and
are rate limited per client through Redis.

- `POST /holds/assigned` reserves specific seats. It requires an
  `Idempotency-Key` header (`400 idempotency_key_required` when absent) and a
  body of `{ eventId, seatIds }`. The server locks each seat, prices it from the
  database, and either holds every requested seat or none. It answers `201` with
  the hold, its seats, server-computed totals, and a database-derived expiry. A
  conflict answers `409 seats_unavailable` listing only the unavailable seat
  ids, never another customer or hold. A repeated key replays the original hold
  rather than reserving twice. PostgreSQL remains authoritative; the hold's
  expiry is mirrored to Redis only as an advisory client countdown.

## Public discovery routes

Discovery routes under `/discovery` are public and unauthenticated. They never
resolve a session and expose only published events and public fields; organizer
schemas, hold ownership, and internal metadata never leave the service. Each
route is rate limited per client IP through Redis and fails open when Redis is
unavailable.

- `GET /discovery/events` lists published events with venue name, start time,
  minimum price, and sale window. It accepts `search`, `timeframe` (`upcoming`,
  `past`, or `all`), `limit`, and `offset`; invalid parameters answer `400`.
  Limited to 120 requests per minute.
- `GET /discovery/events/:eventId` returns the event, its public ticket types,
  and the venue name, or `404` when the event is missing or unpublished. Limited
  to 240 requests per minute.
- `GET /discovery/events/:eventId/availability` returns advisory seat sections
  and general-admission levels. Held and sold seats both read as `unavailable`,
  and admission counts collapse to coarse `available`, `limited`, and `sold_out`
  levels so responses never disclose sales volume. Limited to 120 requests per
  minute.

Availability is advisory: it can change until checkout confirms a hold, and a
client selection is never a reservation.

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
