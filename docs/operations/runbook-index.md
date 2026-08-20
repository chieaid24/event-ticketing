# Operations and Runbooks

Event Ticketing Platform must be operable through documented checks, signals,
and recovery steps.

## Local development

Run the local platform:

```bash
pnpm install
pnpm services:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Docker Compose starts PostgreSQL, Redis, Mailpit, MinIO, a MinIO-backed
Turborepo remote cache, Prometheus, and Grafana from pinned images, binds their
ports to loopback, and waits for health checks. See
[local infrastructure](../../infrastructure/README.md) for endpoints and reset
behavior.

The web, API, and worker validate separate configuration schemas before startup.
`GET /health/live` reports API process liveness. `GET /health/ready` checks
PostgreSQL and Redis within a bounded timeout and returns `503` without error
details when either dependency fails.

The seed writes synthetic users, venues, and a published event with stable
UUIDs; the seeded owner signs in with the documented development-only password
in `packages/database/README.md`. Run `pnpm test:integration` to apply
migrations and seed data in a unique PostgreSQL schema and verify Redis through
a unique key prefix.

## Production

Use Front Door and its WAF policy in front of the container apps. Run web, API,
and worker as Container Apps that accept only Front Door origin traffic. Keep
PostgreSQL Flexible Server and Managed Redis private. Use blob storage for
artifacts and media, Azure Communication Services for email, Key Vault for
credentials, Azure Container Registry for digest-addressed images, and federated
identity credentials for GitHub deployment identity.

Build one image per commit, deploy it to staging, run controlled migrations and
smoke tests, and promote the same image. Do not rebuild for production. Follow
the [Azure deployment guide](azure-deployment.md). The Terraform roots create
delegated private subnets, NAT egress, private zone-redundant data services, and
GitHub federated identity credentials.

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

Available runbooks:

- [Inspect and redeliver outbox dead letters](../runbooks/outbox-dead-letters.md)
- [Recover a refund webhook backlog](../runbooks/refund-webhook-backlog.md)
- [Retry a dead-letter job](../runbooks/dead-letter-jobs.md)
- [Roll back an Azure release](../runbooks/azure-rollback.md)
- [Restore an Azure backup](../runbooks/azure-backup-restoration.md)
- [Rotate Azure runtime secrets](../runbooks/azure-secret-rotation.md)

See [observability](observability.md) for metric collection, trace correlation,
alert rules, dashboards, analytics access, and operational ownership.

## Recovery targets

Start with a 15-minute recovery point objective and a two-hour recovery time
objective for the development deployment. Revise them from measured restoration
drills before making business claims.

## Public repository

Runbooks contain no live account IDs, private endpoints, credentials, customer
data, or undisclosed incident detail. Reference secret names and placeholders,
not values.
