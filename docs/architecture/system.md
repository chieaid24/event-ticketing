# System Architecture

Event Ticketing Platform uses a TypeScript monorepo with independently
deployable web, API, and worker applications.
[ADR 0001](../adr/0001-monorepo-and-service-boundaries.md) records the boundary
and tooling decision. [ADR 0002](../adr/0002-postgresql-transactional-outbox.md)
records durable asynchronous delivery and retry semantics.
[ADR 0010](../adr/0010-azure-container-apps-single-image-deployment.md) records
the Azure network, compute, and immutable-image promotion decision.

```text
Browser and scanner
  -> Front Door and WAF
  -> Next.js web and NestJS API
  -> PostgreSQL, Redis, and Stripe
  -> worker
  -> email, analytics, and operational signals
```

## Boundaries

- `apps/web` renders public and authenticated interfaces. It never connects to
  databases, Redis, Stripe secret APIs, or private objects.
- `apps/api` owns authentication, authorization, validation, pricing, inventory,
  orders, payments, refunds, tickets, scans, and administrative decisions.
- `apps/worker` performs retryable asynchronous work such as outbox delivery,
  hold expiration sweeps, auth and notification email, payment finalization, and
  refunds.
- `packages/contracts` exposes explicit Zod request and response schemas.
- `packages/database` owns Prisma schema, migrations, seed data, transaction
  helpers, and isolated raw SQL repositories for locking-sensitive operations.
- `packages/payments` keeps the payment provider behind one gateway interface
  with Stripe and deterministic fake implementations.
- `packages/config` parses and validates environment variables once at startup.
- `packages/ui` provides accessible shared UI patterns.
- `packages/test-utils` provides deterministic helpers for tests that coordinate
  concurrent work.

Keep public contracts independent from database entities. Keep provider SDKs
behind interfaces. Keep raw SQL parameterized and isolated.

## Technology

- pnpm workspaces and Turborepo
- TypeScript strict mode, ESLint, and Prettier
- Next.js App Router, React, Zod, and hand-written CSS custom properties
- NestJS REST API validated by the shared Zod contracts
- Prisma plus parameterized SQL for inventory locks
- PostgreSQL, Redis, Stripe, Pino, and Prometheus-format metrics
- Vitest, Playwright, and k6
- Docker Compose locally
- Terraform, Container Apps, PostgreSQL Flexible Server, Managed Redis, blob
  storage, Communication Services email, Container Registry, Front Door, WAF,
  Key Vault, and GitHub Actions OIDC in Azure

## Reliability patterns

Database transactions enforce inventory and order invariants. Redis holds
expiring hold mirrors, rate limits, and waiting room queue state. Redis loss
must not make sold inventory available.

Commit an outbox event in the same transaction as domain state. The database
package exposes `enqueueOutboxEvent` for an existing transaction. Workers claim
due events with row locks and `SKIP LOCKED`, set expiring leases, retry with
bounded exponential backoff, and retain dead-letter failures for operators.
Delayed events use `available_at`. Recurring schedules materialize one uniquely
keyed event per scheduled time.

Delivery is at least once. A durable handler receipt suppresses a completed
redelivery, and every provider handler must use the event ID as its idempotency
key. Redis may wake or coordinate workers later, but PostgreSQL remains the
outbox authority.

Every externally retried high-impact mutation uses an actor-scoped idempotency
key and normalized request hash. Reusing one key with different input returns a
stable conflict.

The waiting room uses Redis sorted sets and atomic Lua scripts for queue
ordering, heartbeats, and admission leases. PostgreSQL stores whether an event
requires admission and remains authoritative for every hold. See
[ADR 0007](../adr/0007-redis-waiting-room-admission.md).

## Environment

Web, API, and worker applications have separate Zod schemas. Only intentionally
public browser values use `NEXT_PUBLIC_`. Production services resolve secrets
through Key Vault references. No application reads `process.env` outside its
configuration module.

The local environment runs PostgreSQL, Redis, Mailpit, and MinIO from pinned
container images. The API checks PostgreSQL and Redis readiness with finite
driver and application timeouts. Liveness never depends on external services.

Azure environments run zone-redundant compute and data services. The container
apps environment uses a delegated private subnet, PostgreSQL Flexible Server
uses its own delegated subnet, and Managed Redis, Key Vault, and blob storage
attach through private endpoints. Private DNS zones resolve every data service
inside the virtual network, and one NAT gateway gives outbound provider calls a
stable public address.

Separate web and API Front Door endpoints share one Front Door WAF policy. The
API route overwrites an origin-routing header so paths such as `/organizations`
can exist in both applications without collision. Container app ingress accepts
only Front Door origin traffic. The web, API, and worker apps use separate
arguments, secrets, probes, and scale rules while running the same
digest-addressed image.

Every API response carries a request ID. Structured request logs include the
method, path without query parameters, response status, duration, and request
ID. They exclude headers, cookies, query strings, dependency errors, and
configuration values.

## Public repository boundary

The source repository, pull requests, issues, Actions logs, and test artifacts
are public. Commit only safe placeholders and synthetic data. Application
secrets live outside GitHub. See [SECURITY.md](../../SECURITY.md).
