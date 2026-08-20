# API

`@event-ticketing/api` is the HTTP boundary for trusted platform decisions. It
owns authentication, authorization, inventory, orders, payments, refunds,
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
  currency, schedule, sale window, hold duration, waiting-room requirement,
  customer refund switch and cutoff, inventory return cutoff, and media) under
  optimistic `version` checking; a stale save answers `version_conflict`.
- `PUT .../events/:eventId/ticket-types` replaces the ticket-type set under the
  same `version` check. Each type must match a venue section of its kind, or the
  request answers `ticket_types_invalid`.
- `POST .../events/:eventId/publish` runs `validateEventForPublication` and
  answers `422 event_incomplete` when the event is incomplete or inconsistent.
  On success it snapshots each assigned section's seats into `event_seats`,
  marks the event published, writes an audit entry, and enqueues an
  `event.published` outbox event, all in one transaction.
- `POST .../events/:eventId/cancel` marks an active event cancelled under the
  same `version` check, writes an audit entry, and queues one cancellation
  notification per paid order.

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
- `POST /holds/general-admission` reserves quantities of general-admission
  ticket types with the same idempotency, pricing, and replay rules. A capacity
  conflict answers `409 capacity_unavailable` listing only the oversubscribed
  ticket type ids.

When an event has `waitingRoomEnabled`, both hold routes require an
`x-waiting-room-token` admission token. The first hold attempt binds the token
to its `Idempotency-Key`; retries with the same key remain safe, while another
hold attempt cannot reuse it.

## Waiting-room routes

Waiting-room routes require an authenticated mutation session, CSRF, a trusted
origin, and per-client rate limits.

- `POST /waiting-room/events/:eventId/join` creates or returns the session's one
  queue position and a signed queue token.
- `POST /waiting-room/events/:eventId/heartbeat` extends a live queue entry.
- `POST /waiting-room/events/:eventId/status` returns position and depth, or
  atomically exchanges the head entry for an expiring admission token when
  capacity is available.

Set `WAITING_ROOM_TOKEN_SECRET` to a random value with at least 32 characters.
Tune `WAITING_ROOM_ADMISSION_CAPACITY`, `WAITING_ROOM_HEARTBEAT_TTL_SECONDS`,
`WAITING_ROOM_LEASE_TTL_SECONDS`, and `WAITING_ROOM_TOKEN_TTL_SECONDS` for the
deployment. Enabled events fail closed when Redis is unavailable; PostgreSQL
still decides every inventory mutation.

## Checkout and payment routes

Checkout follows [ADR 0006](../../docs/adr/0006-stripe-payment-finalization.md):
one order per hold, provider intents under stable idempotency keys, and
commercial state decided only by verified webhook processing.

- `POST /checkout` accepts `{ holdId }` for the caller's own hold, creates or
  replays its one order, guarantees a payment intent exists, and answers `201`
  with the authoritative summary and client secret. An expired hold answers
  `409 hold_expired`; a provider outage answers `502` and a retry resumes at
  intent creation.
- `GET /orders/:orderId` returns the actor-scoped authoritative summary. The
  client secret appears only while payment can still proceed.
- `POST /webhooks/payments` is the provider-facing endpoint. It verifies the
  Stripe signature scheme against the raw body, durably records the unique
  event, and commits the asynchronous processing request atomically. Invalid
  signatures answer `400`; duplicates acknowledge without recording twice.
- `POST /payments/simulate` exists only under the fake provider and turns a
  simulated outcome into a signed delivery through the production webhook path.

## Refund routes

Refund routes accept order item IDs and quantities. They calculate the amount
from stored order snapshots and use the request key as the logical retry
boundary.

- `POST /orders/:orderId/refunds` requests a policy-eligible refund for the
  session user's order. It needs an `Idempotency-Key` header and answers `202`
  with the server-calculated target.
- `GET /orders/:orderId/refunds` lists the session user's refund requests.
- `POST /organizations/:organizationId/orders/:orderId/refunds` needs
  `finance.manage`, an `Idempotency-Key` header, and an operator reason.
- `POST /webhooks/payments` also accepts signed Stripe refund updates. The
  worker verifies the provider reference and target before finalizing the
  refund, marking tickets refunded, and conditionally returning inventory.

## Ticket routes

Ticket routes expose a customer's own admission credentials and follow
[ADR 0008](../../docs/adr/0008-qr-ticket-tokens.md): a nonsecret public number
plus the hash of a rotating 256-bit QR bearer, never a stored raw token. Every
response sets `Cache-Control: no-store, private` and
`X-Robots-Tag: noindex, nofollow` so authenticated ticket data is never cached
or indexed. All routes are actor-scoped; another actor's ticket answers the same
`404` as a missing one.

- `GET /account/tickets` lists the session user's tickets with event timezone,
  venue, seat or general-admission detail, and status. It requires a session.
- `GET /tickets/:ticketId` returns one owned ticket's full detail.
- `POST /tickets/:ticketId/qr` mints a fresh QR bearer, stores only its hash,
  and returns the raw token exactly once. It requires a mutation session (CSRF
  and trusted origin). Each call rotates, invalidating the prior bearer; a
  non-active ticket answers `409 ticket_not_active`. The raw token is never
  logged or persisted.

## Scanner routes

Scanner routes live under
`/organizations/:organizationId/events/:eventId/scanner` and follow the
[authorization policy](../../docs/security/authorization.md): check-in and
activity need `scanner.checkin`, reversal needs the supervisor-only
`scanner.reverse`. Every response is sealed against caching and indexing. A
ticket outside the addressed organization answers as an invalid scan with no
ticket reference, so scan history never carries another tenant's data.

- `POST .../scanner/checkins` validates one credential per attempt: the raw QR
  bearer from the camera, or the nonsecret public number as the manual fallback.
  The bearer is hashed immediately and never stored or logged. The ticket row is
  locked with `FOR UPDATE`, so concurrent scans admit exactly once; the loser
  answers `duplicate`. Wrong-event, refunded, void, expired, and unknown
  credentials answer their explicit results, and every attempt appends an
  immutable `scans` row. Requires a mutation session (CSRF and trusted origin)
  plus per-device and per-actor Redis rate limits on top of the per-address
  limit.
- `POST .../scanner/reversals` returns a checked-in ticket to active with a
  required reason. The accepted scan row survives; the reversal appends a
  `reversed` row and both transitions write `ticket.checked_in` /
  `ticket.checkin_reversed` audit entries in the same transaction. A ticket that
  is not checked in answers `409 ticket_not_checked_in`.
- `GET .../scanner/activity` lists the event's most recent scan attempts with
  actor attribution and reversal reasons, plus a `canReverse` flag mirroring the
  caller's permission for UI visibility.

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

Set `API_FRONT_DOOR_PROFILE_ID` in deployed environments to reject requests
whose `X-Azure-FDID` header does not match the environment's Front Door profile;
`/health/live`, `/health/ready`, and `/metrics` stay exempt because probes and
the metrics scrape bypass Front Door. Leave it unset locally to disable
verification.

Every response includes `x-request-id`. The API accepts a bounded, printable
request ID or creates a UUID, then logs the method, path, status, duration, and
request ID as JSON. It does not log headers, query strings, or dependency
errors.

The application depends on `@event-ticketing/config`,
`@event-ticketing/contracts`, `@event-ticketing/database`,
`@event-ticketing/payments`, PostgreSQL, and Redis. It does not require Mailpit
or MinIO for current routes.

## Test

```bash
pnpm --filter @event-ticketing/api test
pnpm --filter @event-ticketing/api test:waiting-room-load
```

See the [system architecture](../../docs/architecture/system.md) and
[security model](../../docs/security/security-model.md).
