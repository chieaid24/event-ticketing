# Web

`@event-ticketing/web` renders public and authenticated product interfaces. It
fetches typed API responses and does not connect to PostgreSQL, Redis, payment
providers, or private object storage.

The current entry point is `/`, a server-rendered service status page. It parses
`GET /status` with the shared contract before displaying API availability.

Public discovery lives at `/events` (published-event listing with search,
timeframe filtering, and pagination) and `/events/[eventId]` (event details,
ticket types, and an accessible availability view). The listing and details
render on the server without a session; the availability view is a client
component that reads advisory seat and admission data, offers a keyboard- and
screen-reader-friendly seat map with a table alternative, and never presents a
client selection as a hold before the server confirms one. Event times render in
the event's own timezone.

Account flows live at `/register`, `/verify-email`, `/login`,
`/forgot-password`, `/reset-password`, and `/account` (session details, password
change, session revocation, sign out). Forms call the API directly with
`credentials: "include"` and echo the readable `et_csrf` cookie as the
`x-csrf-token` header on mutations; `/account` renders server-side by forwarding
the request cookies and redirects to `/login` without a valid session. Browse
the site and the API on the same host (`127.0.0.1` by default) so the browser
treats them as one site for cookies.

Organization flows live at `/organizations` (memberships, invitations, creation)
and `/organizations/[organizationId]` (settings, member roster with invite/role
change/remove, audit log, owner-only deletion). Sections render only when the
caller's permissions from the API allow them; visibility mirrors the
[authorization policy](../../docs/security/authorization.md) and the API remains
the enforcement point.

Venue flows live at `/organizations/[organizationId]/venues` (template list and
creation) and `.../venues/[venueId]` (accessible seat-map preview with a table
alternative, name and description editing, JSON layout editing with a full
client-side validation summary from the shared contract, and confirmed
deletion). Editing controls render only with the `venues.manage` permission.

## Run

```bash
pnpm --filter @event-ticketing/web dev
```

Open `http://127.0.0.1:3000`. Set `API_BASE_URL` when the API does not run at
`http://127.0.0.1:4000`. The server validates this value during startup.

The application depends on `@event-ticketing/config`,
`@event-ticketing/contracts`, and `@event-ticketing/ui`.

## Test

```bash
pnpm --filter @event-ticketing/web test
```

See the [design system](../../DESIGN.md),
[product requirements](../../docs/product/requirements.md), and
[system architecture](../../docs/architecture/system.md).
