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

**Observability**

- Full **Prometheus + Grafana stack** with a provisioned dashboard, five
  checked-in alert rules, and trace-correlated JSON logs.

**Data Layer**

- **PostgreSQL** for inventory, orders, and background jobs
- **Redis** for rate limiting and the waiting room

## Tools Used

<table>
  <tr>
    <td><strong>Application</strong></td>
    <td><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-%233178C6?style=for-the-badge&logo=typescript&logoColor=%23FFFFFF"> <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%235FA04E?style=for-the-badge&logo=nodedotjs&logoColor=%23FFFFFF"> <img alt="NestJS" src="https://img.shields.io/badge/NestJS-%23E0234E?style=for-the-badge&logo=nestjs&logoColor=%23FFFFFF"> <img alt="Next.js" src="https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=nextdotjs&logoColor=%23FFFFFF"></td>
  </tr>
  <tr>
    <td><strong>Data / Services</strong></td>
    <td><img alt="PostgreSQL (Flexible Server)" src="https://img.shields.io/badge/PostgreSQL%20%28Flexible%20Server%29-%234169E1?style=for-the-badge&logo=postgresql&logoColor=%23FFFFFF"> <img alt="Azure Blob Storage" src="https://img.shields.io/badge/Azure%20Blob%20Storage-%230078D4?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgOTYgOTYiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0zMy4zMzggNi41NDRoMjYuMDM4bC0yNy4wMyA4MC4wODdhNC4xNSA0LjE1IDAgMCAxLTMuOTMzIDIuODI0SDguMTQ5YTQuMTQ1IDQuMTQ1IDAgMCAxLTMuOTI4LTUuNDdMMjkuNDA0IDkuMzY4YTQuMTUgNC4xNSAwIDAgMSAzLjkzNC0yLjgyNXoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNNzEuMTc1IDYwLjI2MWgtNDEuMjlhMS45MTEgMS45MTEgMCAwIDAtMS4zMDUgMy4zMDlsMjYuNTMyIDI0Ljc2NGE0LjE3IDQuMTcgMCAwIDAgMi44NDYgMS4xMjFoMjMuMzh6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTMzLjMzOCA2LjU0NGE0LjEyIDQuMTIgMCAwIDAtMy45NDMgMi44NzlMNC4yNTIgODMuOTE3YTQuMTQgNC4xNCAwIDAgMCAzLjkwOCA1LjUzOGgyMC43ODdhNC40NCA0LjQ0IDAgMCAwIDMuNDEtMi45bDUuMDE0LTE0Ljc3NyAxNy45MSAxNi43MDVhNC4yNCA0LjI0IDAgMCAwIDIuNjY2Ljk3Mkg4MS4yNEw3MS4wMjQgNjAuMjYxbC0yOS43ODEuMDA3TDU5LjQ3IDYuNTQ0eiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik02Ni41OTUgOS4zNjRhNC4xNDUgNC4xNDUgMCAwIDAtMy45MjgtMi44MkgzMy42NDhhNC4xNSA0LjE1IDAgMCAxIDMuOTI4IDIuODJsMjUuMTg0IDc0LjYyYTQuMTQ2IDQuMTQ2IDAgMCAxLTMuOTI4IDUuNDcyaDI5LjAyYTQuMTQ2IDQuMTQ2IDAgMCAwIDMuOTI3LTUuNDcyeiIvPjwvc3ZnPg==&logoColor=white">  <img alt="Redis" src="https://img.shields.io/badge/Redis-%23FF4438?style=for-the-badge&logo=redis&logoColor=%23FFFFFF"> <img alt="Prisma" src="https://img.shields.io/badge/Prisma-%232D3748?style=for-the-badge&logo=prisma&logoColor=%23FFFFFF"> <img alt="Stripe" src="https://img.shields.io/badge/Stripe-%23635BFF?style=for-the-badge&logo=stripe&logoColor=%23FFFFFF"> </td>
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

## Features

### Core Features

- Event catalog with live seat and general-admission availability
- Seat and general-admission holds with expiry timers
- Waiting room for on-sale spikes
- Checkout and Stripe payment processing
- Order management and confirmation email
- Rotating QR tickets and door check-in
- Customer and organizer refunds
- Organizer console for venues, events, and pricing
- User authentication, sessions, and role-based access

### Technical Features

- Three-tier architecture (Next.js, NestJS, PostgreSQL) with a background worker
- Transactional outbox with retries and a dead-letter queue
- Row-level locking for inventory correctness
- Redis rate limiting and queueing
- Azure Container Apps deployment
- Infrastructure as Code with Terraform
- Prometheus and Grafana metrics with trace-correlated logs
- Automated CI/CD pipeline

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
pnpm services:up    # postgres, redis, mailpit, turbo cache, prometheus, grafana
pnpm db:migrate && pnpm db:seed:demo    # realistic dataset; pnpm db:seed is the minimal e2e fixture
pnpm dev
```

Every demo account signs in with `demo-password-2026`. Use
`maya.chen@harbourlight.test` for the organizer console and
`jordan.rivera@example.test` for a customer with tickets in every state.

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
compose.yaml      # postgres, redis, mailpit, turbo cache, prometheus, grafana
```
