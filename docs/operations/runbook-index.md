# Operations and Runbooks

Event Ticketing Platform must be operable through documented checks, signals,
and recovery steps.

## Local development

Docker Compose will start PostgreSQL, Redis, Mailpit, and MinIO when object
storage is required. The root workspace will expose install, migrate, seed,
develop, build, lint, type-check, unit, integration, E2E, concurrency, and
format commands.

Each service validates configuration at startup and exposes bounded
`/health/live` and `/health/ready` checks. Seed data is deterministic and uses
documented development-only credentials.

## Production

Use CloudFront and WAF before an Application Load Balancer. Run web, API, and
worker services in private ECS subnets. Keep RDS and ElastiCache private. Use S3
for artifacts and media, SES for email, Secrets Manager for credentials, ECR for
immutable images, and OpenID Connect for GitHub deployment identity.

Build one image per commit, deploy it to staging, run controlled migrations and
smoke tests, and promote the same image. Do not rebuild for production.

## Signals

Collect structured logs with request and trace IDs. Redact sensitive fields.
Measure HTTP latency and errors, hold conflicts and expiry lag, payment and
webhook behavior, scan outcomes, queue depth and wait, worker retries and dead
letters, database saturation, and Redis availability.

Trace holds, checkout, provider calls, webhook processing, ticket issuance,
scanner validation, and refunds.

## Required runbooks

Add executable runbooks under [docs/runbooks](../runbooks/) when the owning
feature lands:

- payment conflict and automatic compensation;
- webhook backlog and failed-event replay;
- hold expiration lag;
- dead-letter job inspection and retry;
- Redis loss;
- database saturation and failover;
- secret rotation;
- rollback;
- backup restoration; and
- suspected QR exposure and token rotation.

Each runbook states trigger, impact, prerequisites, exact checks, mitigation,
verification, rollback, escalation, and evidence to retain.

## Recovery targets

Start with a 15-minute recovery point objective and a two-hour recovery time
objective for the development deployment. Revise them from measured restoration
drills before making business claims.

## Public repository

Runbooks contain no live account IDs, private endpoints, credentials, customer
data, or undisclosed incident detail. Reference secret names and placeholders,
not values.
