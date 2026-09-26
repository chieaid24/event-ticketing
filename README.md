<h1 align="left"> Event Ticketing Platform </h1>

Sells reserved seats and general-admission tickets for live events.

Holds, checkout, payments, refunds, and QR check-in, with PostgreSQL as the only
authority on inventory.

Built for real production workloads with Azure Container Apps, a transactional
outbox, and end-to-end observability.

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
  **Redis** carries rate limits and the waiting room; rate limiting fails open.

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

Every flow runs through the same three tiers: a **Next.js** storefront and back
office, a **NestJS** API that enforces every rule, and **PostgreSQL** as the
only source of truth. A separate **worker** drains a transactional outbox for
the steps that happen after the HTTP response.

**Discovery and Holds**

- Lists published events with live seat and general-admission availability, read
  straight from PostgreSQL.
- Reserves **assigned seats and general admission** under row-level locks: race
  tests prove 100 rival requests for one seat produce exactly one winner, and
  idempotency keys collapse retries into one hold.
- Expires holds on a per-event timer (10 minutes by default); once checkout
  starts, a 15-minute grace window lets in-flight payments finish. A worker
  sweep returns released inventory every 60 seconds.
- Meters on-sale spikes with an optional **Redis waiting room** at the API: a
  FIFO queue that admits shoppers with single-use, HMAC-signed tokens.

**Checkout and Payments**

- Turns a hold into an order server-side: prices come from the hold snapshot,
  never the client, and a unique constraint allows one order per hold.
- Charges through **Stripe** (Payment Element) or a built-in fake provider for
  local runs; both deliver webhooks through one **HMAC-SHA256** verification
  path with replay dedup.
- Finalizes through the **transactional outbox**: the webhook and its job commit
  in one transaction, then the worker marks seats sold, issues tickets, and
  queues the confirmation email. If inventory was lost in the meantime, it
  refunds the charge automatically.
- Retries failed jobs with exponential backoff (8 attempts) into a dead-letter
  queue.

**Tickets and Check-in**

- Reveals a **rotating QR bearer token** on demand: 256 random bits, only the
  SHA-256 hash stored, and each reveal invalidates the last.
- Scans at the door with a **camera scanner (jsQR)** or manual code entry; a row
  lock elects one admission and returns accepted, duplicate, wrong-event,
  refunded, or expired.
- Records every scan and reversal in an append-only log, rate-limited per device
  and per scanner.

**Refunds**

- Accepts customer refunds inside a per-event cutoff window and organizer
  refunds at any time, each keyed for idempotency so retries never
  double-refund.
- Executes through the worker against **Stripe**; the refund webhook then marks
  tickets refunded and returns seats or capacity to sale while the event's
  inventory window is open.
- Closes the order on a full refund and cancels the queued 24-hour reminder
  email.

**Organizer Console and Operations**

- Builds venues as seat maps (rows and seats, or general-admission capacity),
  then events with ticket types, pricing, on-sale windows, hold timers, and
  refund policy.
- Rolls holds, orders, refunds, and scans into daily financial and activity
  tables with database triggers, deferred to commit time so they never block a
  purchase.
- Lists outbox jobs per organization and retries dead-lettered ones from a job
  console, with every action written to the audit log.

**Auth and Accounts**

- Handles auth with **opaque cookie sessions**: argon2id password hashes,
  httpOnly cookie, double-submit CSRF token, Origin allowlist, 24-hour idle and
  30-day absolute expiry, plus a device list with remote revoke.
- Sends email verification and password reset through the worker over **SMTP**
  (nodemailer; Mailpit locally), storing only token hashes.
- Checks six per-organization roles (owner, admin, event manager, finance,
  scanner, viewer) in the API on every request, and applies per-route **Redis**
  rate limits from login at 10 per minute to scanner devices at 60 per minute.

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
                     │                       │
               web endpoint             api endpoint
                     │                       │
         Container Apps environment (VNet, zone redundant)
                     │                       │
        ┌────────────┼───────────┬───────────┴───────────┐
        │            │           │                       │
   web (Next.js)  api (NestJS)  worker (outbox)     migrate job
        │            │           │                       │
        └────── user-assigned managed identity ──────────┘
                  │               │                │
                  ▼               ▼                ▼
           PostgreSQL 17     Managed Redis    Key Vault + Blob
        (zone-redundant HA,  (private          (private
         pgbouncer)           endpoint)         endpoints)

        GitHub Actions ──OIDC──► ACR (Premium, digest-pinned pulls)
```

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

### Run Locally

```bash
corepack enable && pnpm install
pnpm services:up    # postgres, redis, mailpit, minio, turbo cache, prometheus, grafana
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Project Layout

```
apps/
├── web/          # Next.js 16 storefront, organizer console, scanner (App Router)
├── api/          # NestJS REST API: auth, holds, checkout, webhooks, tickets, scanning
└── worker/       # outbox poll loop: payments, refunds, emails, hold-expiry sweep
packages/
├── contracts/    # shared Zod request and response contracts
├── database/     # Prisma schema, migrations, seeds, raw-SQL stores, outbox
├── payments/     # Stripe and fake gateways, shared webhook signature verification
├── config/       # validated environment configuration with production guards
├── ui/           # shared accessible UI components
└── test-utils/
infrastructure/
├── container/        # digest-pinned Dockerfile; one image runs web, api, worker, migrate
├── observability/    # prometheus.yml, alerts.yml, provisioned Grafana dashboard
└── terraform/
    ├── foundation/     # shared delivery: ACR + GitHub OIDC identities
    ├── environments/   # staging and production stacks over the shared modules
    └── modules/        # network, data, platform
scripts/
├── deploy-container-apps.sh    # digest-only promotion: migrate job ► apps ► smoke
├── repeat-integration.mjs      # race suite behind pnpm test:races
└── verify-local-recovery.mjs   # backup and restore drill behind pnpm test:recovery
docs/
├── load-tests/     # k6 purchase-flow, public-read, and waiting-room reports
└── operations/     # observability runbook
.github/workflows/
├── ci.yml          # format ► lint ► types ► build ► tests ► compose E2E ► gitleaks
└── deploy.yml      # OIDC build to ACR, digest promotion: staging ► production
compose.yaml      # postgres, redis, mailpit, minio, turbo cache, prometheus, grafana
```
