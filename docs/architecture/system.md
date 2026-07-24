# System Architecture

Event Ticketing Platform uses a TypeScript monorepo with independently
deployable web, API, and worker applications.

```text
Browser and scanner
  -> CloudFront, WAF, and load balancer
  -> Next.js web and NestJS API
  -> PostgreSQL, Redis, Stripe, S3, and BullMQ
  -> worker
  -> email, artifacts, analytics, and operational signals
```

## Boundaries

- `apps/web` renders public and authenticated interfaces. It never connects to
  databases, Redis, Stripe secret APIs, or private objects.
- `apps/api` owns authentication, authorization, validation, pricing, inventory,
  orders, payments, refunds, tickets, scans, and administrative decisions.
- `apps/worker` performs retryable asynchronous work such as expiration, outbox
  delivery, email, artifacts, reminders, and aggregates.
- `packages/contracts` exposes explicit Zod request and response schemas.
- `packages/database` owns Prisma schema, migrations, seed data, transaction
  helpers, and isolated raw SQL repositories for locking-sensitive operations.
- `packages/config` parses and validates environment variables once at startup.
- `packages/ui` provides accessible shared UI patterns.

Keep public contracts independent from database entities. Keep provider SDKs
behind interfaces. Keep raw SQL parameterized and isolated.

## Technology

- pnpm workspaces and Turborepo
- TypeScript strict mode, ESLint, and Prettier
- Next.js App Router, React, Tailwind CSS, Zod, React Hook Form, and TanStack
  Query
- NestJS REST API with generated OpenAPI
- Prisma plus parameterized SQL for inventory locks
- PostgreSQL, Redis, BullMQ, Stripe, Pino, OpenTelemetry, and Prometheus metrics
- Vitest, React Testing Library, Playwright, Testcontainers, and k6
- Docker Compose locally
- Terraform, ECS Fargate, RDS, ElastiCache, S3, SES, ECR, CloudFront, WAF,
  Secrets Manager, and GitHub Actions OIDC in AWS

## Reliability patterns

Database transactions enforce inventory and order invariants. Redis holds
expiring mirrors, rate limits, queue state, caches, and BullMQ data. Redis loss
must not make sold inventory available.

Commit an outbox event in the same transaction as domain state. Workers claim
events with row locks and `SKIP LOCKED`, retry with bounded exponential backoff,
and retain dead-letter failures for operators.

Every externally retried high-impact mutation uses an actor-scoped idempotency
key and normalized request hash. Reusing one key with different input returns a
stable conflict.

## Environment

Web, API, and worker applications have separate Zod schemas. Only intentionally
public browser values use `NEXT_PUBLIC_`. Production services resolve secrets
from AWS Secrets Manager. No application reads `process.env` outside its
configuration module.

## Public repository boundary

The source repository, pull requests, issues, Actions logs, and test artifacts
are public. Commit only safe placeholders and synthetic data. Application
secrets live outside GitHub. See [SECURITY.md](../../SECURITY.md).
