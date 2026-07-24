# Event Ticketing Platform

Event Ticketing Platform is a production-style event ticketing and venue
management platform. Organizers publish events, customers reserve and buy
inventory, and venue staff validate QR tickets without trusting client-side
state.

Status: specification and autonomous work queue bootstrap.

This is a public repository. Never commit secrets, credentials, personal data,
private incident details, or production configuration. Read
[SECURITY.md](SECURITY.md) before contributing.

## Start here

Read these documents in order:

1. [VISION.md](VISION.md) defines the product direction and repository rules.
2. [CONTEXT.md](CONTEXT.md) defines the domain language.
3. [docs/README.md](docs/README.md) routes you to the relevant specification.
4. [DESIGN.md](DESIGN.md) governs every frontend change.

Use [docs/product/roadmap.md](docs/product/roadmap.md) to understand delivery
order. Use GitHub Issues as the executable dependency queue.

## Validate the repository

```bash
npx --yes pnpm@11.17.0 install
npx --yes pnpm@11.17.0 test
```

The repository test checks required documents, discarded project names, and
broken relative links. Application commands will be added by the foundation
slice.

## Planned codebase

```text
apps/
  web/       Next.js customer, organizer, scanner, and admin UI
  api/       NestJS REST API and domain services
  worker/    BullMQ processors and schedules
packages/
  contracts/ Shared Zod request and response contracts
  database/  Prisma schema, migrations, seeds, and inventory repositories
  config/    Validated environment configuration
  ui/        Shared accessible UI components
  test-utils/
infrastructure/
  docker/    Local service support
  terraform/ AWS infrastructure
docs/        Product and engineering source of truth
```

The nearest `README.md` explains a code area after that area exists. Keep
[docs/README.md](docs/README.md) and [docs/maintenance.md](docs/maintenance.md)
current when the structure changes.
