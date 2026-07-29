# Event Ticketing Platform Documentation

Use this page as the documentation and codebase entry point.

This is a public repository. Apply [the security policy](../SECURITY.md) to
documentation, examples, logs, screenshots, fixtures, and operational records.

## Read by task

| Task                            | Read first                                                       | Then read                                           |
| ------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| Understand product direction    | [Vision](../VISION.md)                                           | [Requirements](product/requirements.md)             |
| Use domain terms                | [Glossary](../CONTEXT.md)                                        | [Domain model](architecture/domain-model.md)        |
| Plan implementation order       | [Roadmap](product/roadmap.md)                                    | GitHub dependency queue                             |
| Change inventory or checkout    | [Inventory and checkout](architecture/inventory-and-checkout.md) | [Security model](security/security-model.md)        |
| Change roles or permissions     | [Authorization policy](security/authorization.md)                | [Security model](security/security-model.md)        |
| Change API or data              | [System architecture](architecture/system.md)                    | [Domain model](architecture/domain-model.md)        |
| Change UI                       | [Design system](../DESIGN.md)                                    | [Requirements](product/requirements.md)             |
| Add or review tests             | [Testing strategy](testing/strategy.md)                          | [Engineering standards](engineering/standards.md)   |
| Operate or deploy               | [Runbook index](operations/runbook-index.md)                     | [Local infrastructure](../infrastructure/README.md) |
| Make a hard-to-reverse decision | [ADR guide](adr/README.md)                                       | Relevant architecture doc                           |
| Change repository structure     | [Maintenance guide](maintenance.md)                              | [System architecture](architecture/system.md)       |

## Document map

- [Product](product/) defines users, scope, behavior, delivery order, and
  acceptance.
- [Architecture](architecture/) defines boundaries, state, data, concurrency,
  and integrations.
- [Engineering](engineering/) defines coding and completion standards.
- [Security](security/) defines trust boundaries, threats, and controls.
- [Testing](testing/) defines the evidence required at each test seam.
- [Operations](operations/) defines local development, observability,
  deployment, recovery, and incident procedures.
- [ADRs](adr/) record hard-to-reverse decisions and their consequences.
- [Runbooks](runbooks/) contain executable operational procedures as they are
  introduced.
- [Load tests](load-tests/) contain k6 scenarios and measured reports.
- [UI evidence](screenshots/) records manually verified product surfaces.
- [Local infrastructure](../infrastructure/README.md) defines Docker service
  startup, endpoints, and destructive reset behavior.

## Implemented decisions and runbooks

- [ADR 0001: Monorepo and service boundaries](adr/0001-monorepo-and-service-boundaries.md)
- [ADR 0002: PostgreSQL transactional outbox](adr/0002-postgresql-transactional-outbox.md)
- [ADR 0006: Stripe payment finalization](adr/0006-stripe-payment-finalization.md)
- [ADR 0007: Redis waiting-room admission](adr/0007-redis-waiting-room-admission.md)
- [ADR 0008: QR ticket tokens](adr/0008-qr-ticket-tokens.md)
- [Inspect and redeliver outbox dead letters](runbooks/outbox-dead-letters.md)

## Ownership map

| Area                  | Responsibility                                           | Primary docs                      |
| --------------------- | -------------------------------------------------------- | --------------------------------- |
| `apps/web`            | Public, account, organizer, scanner, and admin UI        | `DESIGN.md`, product requirements |
| `apps/api`            | HTTP boundaries, authorization, and domain orchestration | system, domain model, security    |
| `apps/worker`         | Outbox, expiry, notification, analytics, and retry jobs  | system, operations                |
| `packages/contracts`  | Shared request and response schemas                      | domain model, standards           |
| `packages/database`   | Schema, migrations, locks, and seeds                     | domain model, inventory           |
| `packages/config`     | Validated application configuration                      | security, operations              |
| `packages/ui`         | Shared accessible UI primitives                          | `DESIGN.md`                       |
| `packages/test-utils` | Shared deterministic test helpers                        | testing strategy                  |
| `infrastructure`      | Local Docker services and planned Terraform              | local infrastructure, operations  |

Each implemented area gets a short local `README.md` that explains its boundary,
entry points, tests, and dependencies. Do not duplicate product rules there;
link back to the owning document.
