# Event Ticketing Platform

Event Ticketing Platform is a production-style event ticketing and venue
management platform. Organizers publish events, customers reserve and buy
inventory, and venue staff validate QR tickets without trusting client-side
state.

The repository contains a runnable TypeScript monorepo with a Next.js web
application, a NestJS API, a worker process, and shared packages. Inventory,
payment, and ticket workflows are delivered through the dependency-aware issue
queue.

This is a public repository. Never commit secrets, credentials, personal data,
private incident details, or production configuration. Read
[SECURITY.md](SECURITY.md) before contributing.

## Tools Used

<table>
  <tr>
    <td><strong>Application</strong></td>
    <td><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-%233178C6?style=for-the-badge&logo=typescript&logoColor=%23FFFFFF"> <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%235FA04E?style=for-the-badge&logo=nodedotjs&logoColor=%23FFFFFF"> <img alt="NestJS" src="https://img.shields.io/badge/NestJS-%23E0234E?style=for-the-badge&logo=nestjs&logoColor=%23FFFFFF"> <img alt="Next.js" src="https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=nextdotjs&logoColor=%23FFFFFF"></td>
  </tr>
  <tr>
    <td><strong>Data / Messaging</strong></td>
    <td><img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-%234169E1?style=for-the-badge&logo=postgresql&logoColor=%23FFFFFF"> <img alt="Prisma" src="https://img.shields.io/badge/Prisma-%232D3748?style=for-the-badge&logo=prisma&logoColor=%23FFFFFF"> <img alt="Redis" src="https://img.shields.io/badge/Redis-%23FF4438?style=for-the-badge&logo=redis&logoColor=%23FFFFFF"> <img alt="MinIO" src="https://img.shields.io/badge/MinIO-%23C72E49?style=for-the-badge&logo=minio&logoColor=%23FFFFFF"></td>
  </tr>
  <tr>
    <td><strong>Payments / Email</strong></td>
    <td><img alt="Stripe" src="https://img.shields.io/badge/Stripe-%23635BFF?style=for-the-badge&logo=stripe&logoColor=%23FFFFFF"> <img alt="Azure Communication Services" src="https://img.shields.io/badge/Azure%20Communication%20Services-%230078D4?style=for-the-badge&logo=microsoftazure&logoColor=%23FFFFFF"> <img alt="Mailpit" src="https://img.shields.io/badge/Mailpit-%232E7D9A?style=for-the-badge&logo=maildotru&logoColor=%23FFFFFF"></td>
  </tr>
  <tr>
    <td><strong>Testing</strong></td>
    <td><img alt="Vitest" src="https://img.shields.io/badge/Vitest-%236E9F18?style=for-the-badge&logo=vitest&logoColor=%23FFFFFF"> <img alt="Playwright" src="https://img.shields.io/badge/Playwright-%232EAD33?style=for-the-badge&logo=playwright&logoColor=%23FFFFFF"></td>
  </tr>
  <tr>
    <td><strong>Observability</strong></td>
    <td><img alt="Prometheus" src="https://img.shields.io/badge/Prometheus-%23E6522C?style=for-the-badge&logo=prometheus&logoColor=%23FFFFFF"> <img alt="Grafana" src="https://img.shields.io/badge/Grafana-%23F46800?style=for-the-badge&logo=grafana&logoColor=%23FFFFFF"> <img alt="Azure Monitor" src="https://img.shields.io/badge/Azure%20Monitor-%230078D4?style=for-the-badge&logo=microsoftazure&logoColor=%23FFFFFF"></td>
  </tr>
  <tr>
    <td><strong>Infrastructure</strong></td>
    <td><img alt="Docker" src="https://img.shields.io/badge/Docker-%232496ED?style=for-the-badge&logo=docker&logoColor=%23FFFFFF"> <img alt="Terraform" src="https://img.shields.io/badge/Terraform-%23844FBA?style=for-the-badge&logo=terraform&logoColor=%23FFFFFF"> <img alt="Azure Container Apps" src="https://img.shields.io/badge/Azure%20Container%20Apps-%230078D4?style=for-the-badge&logo=microsoftazure&logoColor=%23FFFFFF"> <img alt="GitHub Actions" src="https://img.shields.io/badge/GitHub%20Actions-%232088FF?style=for-the-badge&logo=githubactions&logoColor=%23FFFFFF"> <img alt="Turborepo" src="https://img.shields.io/badge/Turborepo-%23EF4444?style=for-the-badge&logo=turborepo&logoColor=%23FFFFFF"> <img alt="pnpm" src="https://img.shields.io/badge/pnpm-%23F69220?style=for-the-badge&logo=pnpm&logoColor=%23FFFFFF"></td>
  </tr>
</table>

## Start here

Read these documents in order:

1. [VISION.md](VISION.md) defines the product direction and repository rules.
2. [CONTEXT.md](CONTEXT.md) defines the domain language.
3. [docs/README.md](docs/README.md) routes you to the relevant specification.
4. [DESIGN.md](DESIGN.md) governs every frontend change.

Use [docs/product/roadmap.md](docs/product/roadmap.md) to understand delivery
order. Use GitHub Issues as the executable dependency queue.

## Run locally

```bash
corepack enable
pnpm install
pnpm services:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://127.0.0.1:3000` for the web status page. The API listens at
`http://127.0.0.1:4000`, and the worker writes structured lifecycle events to
standard output. Mailpit listens at `http://127.0.0.1:8025`, and the MinIO
console listens at `http://127.0.0.1:9001`. Press `Ctrl+C` to stop the
applications, then run `pnpm services:down` to stop local dependencies.

Node.js 24, pnpm 11.17.0, Docker, and Docker Compose are required. The tracked
defaults use local-only synthetic configuration and require no external
credentials. Copy `.env.example` only when you need to override a default.

## Validate the repository

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

These commands format-check every file, lint and type-check each workspace,
execute repository and unit tests, and build all applications and packages. Run
`pnpm test:integration` while PostgreSQL and Redis are running to apply the
migration and seed in an isolated PostgreSQL schema and Redis key prefix.

Run the release verification suites while the local services are running:

```bash
pnpm test:races
pnpm test:recovery
pnpm exec playwright install chromium
pnpm test:e2e
```

The race runner repeats the isolated integration suite three times by default.
Set `RACE_RUNS` from 1 through 20 to change the repetition count. The recovery
runner creates and removes a temporary PostgreSQL database after comparing a
restored backup with the source. Playwright starts the web, API, and worker
processes and exercises the complete fake-provider release journey.

## Codebase

```text
apps/
  web/       Next.js customer, organizer, scanner, and admin UI
  api/       NestJS REST API and domain services
  worker/    PostgreSQL outbox processors and schedules
packages/
  contracts/ Shared Zod request and response contracts
  database/  Prisma schema, migrations, seeds, and inventory repositories
  config/    Validated environment configuration
  ui/        Shared accessible UI components
  test-utils/
infrastructure/
  README.md  Local PostgreSQL, Redis, Mailpit, and MinIO operations
  terraform/ Azure delivery, staging, and production infrastructure
docs/        Product and engineering source of truth
```

The nearest `README.md` explains a code area after that area exists. Keep
[docs/README.md](docs/README.md) and [docs/maintenance.md](docs/maintenance.md)
current when the structure changes.
