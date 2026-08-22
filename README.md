<h1 align="left"> Event Ticketing Platform </h1>

Sells reserved seats and general-admission tickets for live events.

Holds, checkout, payments, refunds, and QR check-in, with PostgreSQL as the only
authority on inventory.

Built for real production workloads with Azure Container Apps, a transactional
outbox, and end-to-end observability.

[![CI](https://img.shields.io/github/actions/workflow/status/chieaid24/event-ticketing/ci.yml?branch=main&label=CI)](https://github.com/chieaid24/event-ticketing/actions/workflows/ci.yml)

## Technical Highlights

**Infrastructure**

- Azure architecture is **100% Infrastructure as Code** with Terraform, promoted
  through GitHub Actions.
- **Cloud-native Container Apps** with KEDA autoscaling, zone redundancy, and
  digest-pinned rolling deployments.

**CI/CD**

- Automated **GitHub Actions** pipeline that validates every workspace -> runs
  the race, recovery, and E2E suites -> builds one immutable image -> promotes
  staging, then production.
- **GitHub OIDC** federated identity on every Azure call, so no stored cloud
  credentials.

**Observability**

- Full **Prometheus + Grafana stack** with a provisioned dashboard, five
  checked-in alert rules, and trace-correlated JSON logs.

**Data Layer**

- **PostgreSQL is authoritative** for inventory, orders, and background jobs;
  **Redis** carries rate limits and the waiting room, and fails open.

## Tools Used

<table>
  <tr>
    <td><strong>Application</strong></td>
    <td><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-%233178C6?style=for-the-badge&logo=typescript&logoColor=%23FFFFFF"> <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%235FA04E?style=for-the-badge&logo=nodedotjs&logoColor=%23FFFFFF"> <img alt="NestJS" src="https://img.shields.io/badge/NestJS-%23E0234E?style=for-the-badge&logo=nestjs&logoColor=%23FFFFFF"> <img alt="Next.js" src="https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=nextdotjs&logoColor=%23FFFFFF"></td>
  </tr>
  <tr>
    <td><strong>Data / Services</strong></td>
    <td><img alt="PostgreSQL (Flexible Server)" src="https://img.shields.io/badge/PostgreSQL%20%28Flexible%20Server%29-%234169E1?style=for-the-badge&logo=postgresql&logoColor=%23FFFFFF"> <img alt="Azure Blob Storage" src="https://img.shields.io/badge/Azure%20Blob%20Storage-%230078D4?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgOTYgOTYiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0zMy4zMzggNi41NDRoMjYuMDM4bC0yNy4wMyA4MC4wODdhNC4xNSA0LjE1IDAgMCAxLTMuOTMzIDIuODI0SDguMTQ5YTQuMTQ1IDQuMTQ1IDAgMCAxLTMuOTI4LTUuNDdMMjkuNDA0IDkuMzY4YTQuMTUgNC4xNSAwIDAgMSAzLjkzNC0yLjgyNXoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNNzEuMTc1IDYwLjI2MWgtNDEuMjlhMS45MTEgMS45MTEgMCAwIDAtMS4zMDUgMy4zMDlsMjYuNTMyIDI0Ljc2NGE0LjE3IDQuMTcgMCAwIDAgMi44NDYgMS4xMjFoMjMuMzh6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTMzLjMzOCA2LjU0NGE0LjEyIDQuMTIgMCAwIDAtMy45NDMgMi44NzlMNC4yNTIgODMuOTE3YTQuMTQgNC4xNCAwIDAgMCAzLjkwOCA1LjUzOGgyMC43ODdhNC40NCA0LjQ0IDAgMCAwIDMuNDEtMi45bDUuMDE0LTE0Ljc3NyAxNy45MSAxNi43MDVhNC4yNCA0LjI0IDAgMCAwIDIuNjY2Ljk3Mkg4MS4yNEw3MS4wMjQgNjAuMjYxbC0yOS43ODEuMDA3TDU5LjQ3IDYuNTQ0eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik02Ni41OTUgOS4zNjRhNC4xNDUgNC4xNDUgMCAwIDAtMy45MjgtMi44MkgzMy42NDhhNC4xNSA0LjE1IDAgMCAxIDMuOTI4IDIuODJsMjUuMTg0IDc0LjYyYTQuMTQ2IDQuMTQ2IDAgMCAxLTMuOTI4IDUuNDcyaDI5LjAyYTQuMTQ2IDQuMTQ2IDAgMCAwIDMuOTI3LTUuNDcyeiIvPjwvc3ZnPg==&logoColor=white">  <img alt="Redis" src="https://img.shields.io/badge/Redis-%23FF4438?style=for-the-badge&logo=redis&logoColor=%23FFFFFF"> <img alt="MinIO" src="https://img.shields.io/badge/MinIO-%23C72E49?style=for-the-badge&logo=minio&logoColor=%23FFFFFF"> <img alt="Prisma" src="https://img.shields.io/badge/Prisma-%232D3748?style=for-the-badge&logo=prisma&logoColor=%23FFFFFF"> <img alt="Stripe" src="https://img.shields.io/badge/Stripe-%23635BFF?style=for-the-badge&logo=stripe&logoColor=%23FFFFFF"> </td>
  </tr>
  <tr>
    <td><strong>Observability</strong></td>
    <td><img alt="Azure Monitor" src="https://img.shields.io/badge/Azure%20Monitor-%230078D4?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgOTYgOTYiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0zMy4zMzggNi41NDRoMjYuMDM4bC0yNy4wMyA4MC4wODdhNC4xNSA0LjE1IDAgMCAxLTMuOTMzIDIuODI0SDguMTQ5YTQuMTQ1IDQuMTQ1IDAgMCAxLTMuOTI4LTUuNDdMMjkuNDA0IDkuMzY4YTQuMTUgNC4xNSAwIDAgMSAzLjkzNC0yLjgyNXoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNNzEuMTc1IDYwLjI2MWgtNDEuMjlhMS45MTEgMS45MTEgMCAwIDAtMS4zMDUgMy4zMDlsMjYuNTMyIDI0Ljc2NGE0LjE3IDQuMTcgMCAwIDAgMi44NDYgMS4xMjFoMjMuMzh6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTMzLjMzOCA2LjU0NGE0LjEyIDQuMTIgMCAwIDAtMy45NDMgMi44NzlMNC4yNTIgODMuOTE3YTQuMTQgNC4xNCAwIDAgMCAzLjkwOCA1LjUzOGgyMC43ODdhNC40NCA0LjQ0IDAgMCAwIDMuNDEtMi45bDUuMDE0LTE0Ljc3NyAxNy45MSAxNi43MDVhNC4yNCA0LjI0IDAgMCAwIDIuNjY2Ljk3Mkg4MS4yNEw3MS4wMjQgNjAuMjYxbC0yOS43ODEuMDA3TDU5LjQ3IDYuNTQ0eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik02Ni41OTUgOS4zNjRhNC4xNDUgNC4xNDUgMCAwIDAtMy45MjgtMi44MkgzMy42NDhhNC4xNSA0LjE1IDAgMCAxIDMuOTI4IDIuODJsMjUuMTg0IDc0LjYyYTQuMTQ2IDQuMTQ2IDAgMCAxLTMuOTI4IDUuNDcyaDI5LjAyYTQuMTQ2IDQuMTQ2IDAgMCAwIDMuOTI3LTUuNDcyeiIvPjwvc3ZnPg==&logoColor=white"> <img alt="Prometheus" src="https://img.shields.io/badge/Prometheus-%23E6522C?style=for-the-badge&logo=prometheus&logoColor=%23FFFFFF"> <img alt="Grafana" src="https://img.shields.io/badge/Grafana-%23F46800?style=for-the-badge&logo=grafana&logoColor=%23FFFFFF">   </td>
  </tr>
  <tr>
    <td><strong>Infrastructure</strong></td>
    <td> <img alt="Static Badge" src="https://img.shields.io/badge/Azure%20Container%20Apps-%230078d4?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgOTYgOTYiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0zMy4zMzggNi41NDRoMjYuMDM4bC0yNy4wMyA4MC4wODdhNC4xNSA0LjE1IDAgMCAxLTMuOTMzIDIuODI0SDguMTQ5YTQuMTQ1IDQuMTQ1IDAgMCAxLTMuOTI4LTUuNDdMMjkuNDA0IDkuMzY4YTQuMTUgNC4xNSAwIDAgMSAzLjkzNC0yLjgyNXoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNNzEuMTc1IDYwLjI2MWgtNDEuMjlhMS45MTEgMS45MTEgMCAwIDAtMS4zMDUgMy4zMDlsMjYuNTMyIDI0Ljc2NGE0LjE3IDQuMTcgMCAwIDAgMi44NDYgMS4xMjFoMjMuMzh6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTMzLjMzOCA2LjU0NGE0LjEyIDQuMTIgMCAwIDAtMy45NDMgMi44NzlMNC4yNTIgODMuOTE3YTQuMTQgNC4xNCAwIDAgMCAzLjkwOCA1LjUzOGgyMC43ODdhNC40NCA0LjQ0IDAgMCAwIDMuNDEtMi45bDUuMDE0LTE0Ljc3NyAxNy45MSAxNi43MDVhNC4yNCA0LjI0IDAgMCAwIDIuNjY2Ljk3Mkg4MS4yNEw3MS4wMjQgNjAuMjYxbC0yOS43ODEuMDA3TDU5LjQ3IDYuNTQ0eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik02Ni41OTUgOS4zNjRhNC4xNDUgNC4xNDUgMCAwIDAtMy45MjgtMi44MkgzMy42NDhhNC4xNSA0LjE1IDAgMCAxIDMuOTI4IDIuODJsMjUuMTg0IDc0LjYyYTQuMTQ2IDQuMTQ2IDAgMCAxLTMuOTI4IDUuNDcyaDI5LjAyYTQuMTQ2IDQuMTQ2IDAgMCAwIDMuOTI3LTUuNDcyeiIvPjwvc3ZnPg==&logoColor=white"> <img alt="Docker" src="https://img.shields.io/badge/Docker-%232496ED?style=for-the-badge&logo=docker&logoColor=%23FFFFFF"> <img alt="Terraform" src="https://img.shields.io/badge/Terraform-%23844FBA?style=for-the-badge&logo=terraform&logoColor=%23FFFFFF"> 
 <img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub%20Actions-%232088FF?style=for-the-badge&logo=githubactions&logoColor=%23FFFFFF"></td>
  </tr>
</table>

## Functional Overview

**Ticketing Pipeline**

- Reserves **assigned seats and general admission** under concurrency: race
  tests prove 100 rival requests for one seat produce exactly one winner.
- Expires holds inside PostgreSQL after 10 minutes, with a 15-minute grace
  window so in-flight payments still finalize.
- Shields on-sale spikes with an optional **Redis waiting room** that issues
  HMAC-signed admission tokens.

**Payments**

- Charges through **Stripe or a built-in fake provider**; both deliver webhooks
  over the same HMAC-SHA256 verification path with replay dedup.
- Finalizes orders through the **transactional outbox**: webhook receipt and job
  enqueue commit in one transaction, and the worker retries with exponential
  backoff into a dead-letter queue.
- Handles **customer and organizer refunds** with idempotency keys and per-event
  cutoff windows.

**Ticket Validation**

- Issues **rotating QR bearer tokens** - only the SHA-256 hash is stored, and
  every reveal rotates the token.
- Scans with a **camera scanner** (jsQR) or manual code entry: duplicate,
  wrong-event, refunded, and void verdicts, reversals, and an append-only scan
  log.

**Web and Auth**

- **Next.js storefront and back office** - discovery, checkout, organizer
  console, operations analytics, and the door scanner.
- Handles auth with **opaque cookie sessions** - argon2id passwords,
  double-submit CSRF, and six per-organization roles from owner to scanner.

## Azure-Specific Architecture

Application runs on Azure Container Apps behind Front Door Premium, with managed
PostgreSQL Flexible Server and Managed Redis.

- Web and API autoscale on HTTP concurrency; the worker scales on a KEDA
  PostgreSQL query over the outbox backlog.
- Every data service disables public network access and is reachable only over
  VNet private endpoints; the API rejects any request that did not come through
  Front Door.
- Infrastructure defined in Terraform (foundation + staging + production), and
  both environments run the same sha256-digest image.

```
              Azure Front Door Premium + WAF (Prevention)
                     |                       |
               web endpoint             api endpoint
                     |                       |
         Container Apps environment (VNet, zone redundant)
                     |                       |
        +------------+-----------+-----------+-----------+
        |            |           |                       |
   web (Next.js)  api (NestJS)  worker (outbox)     migrate job
        |            |           |                       |
        +------ user-assigned managed identity ----------+
                  |               |                |
                  v               v                v
           PostgreSQL 17     Managed Redis    Key Vault + Blob
        (zone-redundant HA,  (private          (private
         pgbouncer)           endpoint)         endpoints)

        GitHub Actions --OIDC--> ACR (Premium, digest-pinned pulls)
```

## Feature Details

<details>
<summary><strong>Services</strong></summary>

<br>

| Service | Port | Persistence       | What it does                                                                                                                                                       |
| ------- | ---- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| web     | 3000 | -                 | Server-rendered Next.js storefront, organizer console, and scanner. Talks to the API over HTTP only; ingress restricted to Front Door.                             |
| api     | 4000 | PostgreSQL, Redis | NestJS HTTP boundary for discovery, auth, holds, waiting room, checkout, payment webhooks, refunds, tickets, scanning, and operations. Raw SQL over a pg pool.     |
| worker  | -    | PostgreSQL        | Drains the transactional outbox with 12 handlers: payment finalization, refunds, auth email, notifications, and a 60 s hold-expiry sweep. Scales on backlog depth. |

</details>

<details>
<summary><strong>Frontend</strong></summary>

<br>

Next.js 16 App Router (TypeScript) served by the web container app; pages hold
no database access and go through the API for everything.

### Auth

- **Opaque cookie sessions** - argon2id password hashes, httpOnly session
  cookie, double-submit CSRF token, and an Origin allowlist on every mutation.
- **Route protection** - signed-out visitors redirect to `/login`; ticket and
  scanner pages are noindexed and served no-store.

### Pages

| Route                                        | Description                                                        |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `/events`                                    | Public discovery with search and timeframe filters                 |
| `/events/[eventId]`                          | Event detail with live seat and general-admission availability     |
| `/checkout/[holdId]`                         | Stripe payment element, or simulation buttons on the fake provider |
| `/orders/[orderId]`                          | Order status with a payment-processing poll                        |
| `/account/tickets`                           | Ticket list with one-time QR reveal                                |
| `/organizations/[organizationId]`            | Members, roles, settings, and audit log                            |
| `/organizations/[organizationId]/operations` | Analytics plus an outbox job console with dead-letter retry        |
| `/scan/[organizationId]/[eventId]`           | Camera QR scanner with manual entry and check-in reversal          |

</details>

<details>
<summary><strong>Observability</strong></summary>

<br>

All services emit structured JSON logs; the API also serves Prometheus metrics.

```
api
  |-- GET /metrics (Prometheus text) ------> Prometheus ------> Grafana
  |-- pino JSON (request_id, trace_id) ----> stdout ----------> Log Analytics
worker
  |-- JSON cycle events -------------------> stdout ----------> Log Analytics
```

- **Metrics** - Prometheus scrapes `/metrics` every 15 s: HTTP request counters
  and latency histograms plus live outbox gauges, with dynamic path segments
  normalized to bound cardinality.
- **Logs** - one JSON line per request carrying `duration_ms`, `status_code`,
  `request_id`, and a W3C `traceparent`-compatible `trace_id`, both echoed on
  the response.
- **Alerts** - five checked-in rules: API down, 5xx ratio above 2%, p95 above 1
  s, any dead-letter job, and a ready job older than 5 minutes.

### Provisioned Dashboard

| Panel                    | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| Request rate             | HTTP request throughput                              |
| Server error rate        | Share of 5xx responses                               |
| Request latency          | p95 from the duration histogram                      |
| Background jobs by state | Outbox gauges: ready, delayed, retrying, dead-letter |
| Oldest ready job         | Backlog age that also drives the worker scale rule   |

Operating notes live in
[docs/operations/observability.md](docs/operations/observability.md).

</details>

<details>
<summary><strong>CI/CD Pipeline</strong></summary>

<br>

### Overview

```
pull request / push to main
    |
    v
ci.yml
    |-- format -> lint -> typecheck -> build -> unit tests   (cheapest first)
    |-- shellcheck + terraform fmt/validate (foundation, staging, production)
    |-- docker compose up -> migrate -> seed -> races x3 -> recovery -> e2e
    |-- image build -> API smoke test -> gitleaks secret scan
    v
deploy.yml (push to main, or manual)
    |-- build       OIDC login -> ACR; skipped when the commit digest exists
    |-- staging     migration job -> web/api/worker on the digest -> smoke
    |-- production  same script, same digest, only after staging succeeds
```

- **Immutable digests** - the deploy script rejects any image reference without
  a sha256 digest, and a failed migration leaves the old revisions serving.
- **Concurrency guard** - one deploy run at a time, never cancelled
  mid-promotion.
- **Secret scanning** - gitleaks runs on every CI build.

All workflows use **GitHub OIDC** federated identity, so no stored Azure
credentials.

</details>

<details>
<summary><strong>Production Hardening</strong></summary>

<br>

| Feature                | Configuration                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Autoscaling**        | web/api scale at 50 concurrent requests up to 4x baseline; worker scales on a KEDA outbox-backlog query    |
| **WAF**                | Front Door Premium in Prevention mode: Microsoft default + bot rule sets, 2000 req / 5 min per-IP limit    |
| **Private networking** | PostgreSQL, Redis, Key Vault, and Blob disable public access; private endpoints and delegated subnets only |
| **Origin lock**        | API returns 403 without the Front Door profile header; NSG admits only Front Door on 443                   |
| **Zone redundancy**    | Container Apps environment, ACR, and PostgreSQL ZoneRedundant HA with a standby zone                       |
| **Secrets**            | Key Vault references resolved by a user-assigned managed identity; no literals in Terraform or app config  |
| **Config guards**      | Production boot refuses dev secrets, disabled rate limits, and any payment provider except Stripe          |
| **Data protection**    | 35-day PostgreSQL backups, blob versioning, CanNotDelete locks on the database and artifact store          |
| **Rate limiting**      | Per-route Redis budgets on every endpoint, from login at 10/min to scanner devices at 60/min               |

</details>

<details>
<summary><strong>Deployments (Azure / Local)</strong></summary>

<br>

Production runs on Azure Container Apps; a Docker Compose stack covers local
development. Both run the same image, whose entrypoint selects `web`, `api`,
`worker`, or `migrate`.

### Azure Resources (Terraform)

| Resource                   | Details                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| VNet                       | Delegated subnets for Container Apps and PostgreSQL, private-endpoint subnet, NAT egress   |
| Container Apps             | Zone-redundant environment: web, api, worker, and a manual migration job                   |
| PostgreSQL Flexible Server | v17, D2ds_v5 (staging) / D4ds_v5 (production), ZoneRedundant HA, pgbouncer, 35-day backups |
| Managed Redis              | Balanced B1 (staging) / B10 (production), high availability, TLS-only, private endpoint    |
| Blob Storage               | ZRS, versioned, 30-day delete retention, shared keys disabled                              |
| Key Vault                  | RBAC-only, purge protection, private endpoint                                              |
| ACR                        | Premium, zone redundant, anonymous pull disabled                                           |
| Front Door Premium         | WAF in Prevention mode, health-probed origin groups, HTTPS-only routes                     |
| Communication Services     | Azure-managed email domain for verification and notification mail                          |
| Log Analytics              | 30-day retention, PostgreSQL and Front Door diagnostics, Front Door 5xx metric alert       |
| Federated identities       | Build and per-environment deploy identities for GitHub OIDC                                |

### Deploy from Scratch

```bash
# 1. shared delivery resources (ACR, GitHub OIDC identities)
cd infrastructure/terraform/foundation
terraform init && terraform apply

# 2. environment stack (repeat under environments/production)
cd ../environments/staging
terraform init && terraform apply

# 3. set the repository's Azure variables, then push to main;
#    deploy.yml builds the image and promotes staging -> production
```

### Teardown

```bash
# CanNotDelete locks guard the database and artifact store:
# apply with deletion_protection = false first, then destroy
terraform destroy
```

### Run Locally

```bash
corepack enable && pnpm install
pnpm services:up    # postgres, redis, mailpit, minio, turbo cache, prometheus, grafana
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Web at `http://127.0.0.1:3000`, API at `:4000`, Mailpit at `:8025`, MinIO
console at `:9001`, Prometheus at `:9090`, Grafana at `:3001`, and the Turborepo
remote cache at `:9080`. Tracked defaults are local-only synthetic
configuration; copy `.env.example` only to override one. `pnpm services:down`
stops everything.

### Validate

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:integration    # isolated PostgreSQL schema + Redis key prefix
pnpm test:races && pnpm test:recovery
pnpm exec playwright install chromium && pnpm test:e2e
```

</details>

<details>
<summary><strong>Correctness and Recovery</strong></summary>

<br>

- **Race suite** (`pnpm test:races`) repeats the isolated integration suite
  three times: 100 concurrent claims on one seat yield exactly one winner,
  general-admission counters never oversell, idempotency-key replays collapse to
  one hold, and two workers never double-claim an outbox job.
- **Recovery drill** (`pnpm test:recovery`) proves transaction rollback, dumps
  the live database with `pg_dump`, restores into a throwaway database, and
  compares row counts before dropping it.
- **Schema isolation** - every integration run creates its own PostgreSQL schema
  and Redis key prefix, then drops both on exit.
- **Invariant checker** - 8 SQL checks (oversold counters, double-booked seats,
  orphan tickets, dead holds still reserving) run against load-test output: 0
  violations across 9,300 paid orders and 13,864 tickets.

</details>

## Load Testing

I load-tested the purchase flow with k6 against the built API and worker: 50
virtual users completed 1,117 purchases at 10.2/s with zero failed checks, and
the invariant checker found nothing oversold across 9,300 cumulative paid
orders. The bottleneck worth reading about: a synchronous analytics trigger
serialized every purchase on one hot row until a deferred-trigger migration cut
hold p95 from 19 s to 108 ms. Reports live in `docs/load-tests/`, starting with
[the purchase-flow run](docs/load-tests/2026-08-20-purchase-flow.md).

## Project Layout

```
apps/
  web/          # Next.js 16 storefront, organizer console, scanner (App Router)
  api/          # NestJS REST API: auth, holds, checkout, webhooks, tickets, scanning
  worker/       # outbox poll loop: payments, refunds, emails, hold-expiry sweep
packages/
  contracts/    # shared Zod request and response contracts
  database/     # Prisma schema, migrations, seeds, raw-SQL stores, outbox
  payments/     # Stripe and fake gateways, shared webhook signature verification
  config/       # validated environment configuration with production guards
  ui/           # shared accessible UI components
  test-utils/
infrastructure/
  container/        # digest-pinned Dockerfile; one image runs web, api, worker, migrate
  observability/    # prometheus.yml, alerts.yml, provisioned Grafana dashboard
  terraform/
    foundation/     # shared delivery: ACR + GitHub OIDC identities
    environments/   # staging and production stacks over the shared modules
    modules/        # network, data, platform
scripts/
  deploy-container-apps.sh    # digest-only promotion: migrate job -> apps -> smoke
  repeat-integration.mjs      # race suite behind pnpm test:races
  verify-local-recovery.mjs   # backup and restore drill behind pnpm test:recovery
docs/
  load-tests/     # k6 purchase-flow, public-read, and waiting-room reports
  operations/     # observability runbook
.github/workflows/
  ci.yml          # format -> lint -> types -> build -> tests -> compose E2E -> gitleaks
  deploy.yml      # OIDC build to ACR, digest promotion: staging -> production
compose.yaml      # postgres, redis, mailpit, minio, turbo cache, prometheus, grafana
```
