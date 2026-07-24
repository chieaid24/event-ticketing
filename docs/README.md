# SeatFlow Documentation

Use this page as the documentation and codebase entry point.

This is a public repository. Apply [the security policy](../SECURITY.md) to
documentation, examples, logs, screenshots, fixtures, and operational records.

## Read by task

| Task                            | Read first                                                       | Then read                                         |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| Understand product direction    | [Vision](../VISION.md)                                           | [Requirements](product/requirements.md)           |
| Use domain terms                | [Glossary](../CONTEXT.md)                                        | [Domain model](architecture/domain-model.md)      |
| Plan implementation order       | [Roadmap](product/roadmap.md)                                    | GitHub dependency queue                           |
| Change inventory or checkout    | [Inventory and checkout](architecture/inventory-and-checkout.md) | [Security model](security/security-model.md)      |
| Change API or data              | [System architecture](architecture/system.md)                    | [Domain model](architecture/domain-model.md)      |
| Change UI                       | [Design system](../DESIGN.md)                                    | [Requirements](product/requirements.md)           |
| Add or review tests             | [Testing strategy](testing/strategy.md)                          | [Engineering standards](engineering/standards.md) |
| Operate or deploy               | [Runbook index](operations/runbook-index.md)                     | [System architecture](architecture/system.md)     |
| Make a hard-to-reverse decision | [ADR guide](adr/README.md)                                       | Relevant architecture doc                         |
| Change repository structure     | [Maintenance guide](maintenance.md)                              | [System architecture](architecture/system.md)     |

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

## Planned ownership map

| Area                 | Responsibility                                           | Primary docs                      |
| -------------------- | -------------------------------------------------------- | --------------------------------- |
| `apps/web`           | Public, account, organizer, scanner, and admin UI        | `DESIGN.md`, product requirements |
| `apps/api`           | HTTP boundaries, authorization, and domain orchestration | system, domain model, security    |
| `apps/worker`        | Outbox, expiry, notification, analytics, and retry jobs  | system, operations                |
| `packages/contracts` | Shared request and response schemas                      | domain model, standards           |
| `packages/database`  | Schema, migrations, locks, and seeds                     | domain model, inventory           |
| `packages/config`    | Validated application configuration                      | security, operations              |
| `packages/ui`        | Shared accessible UI primitives                          | `DESIGN.md`                       |
| `infrastructure`     | Docker and Terraform                                     | operations                        |

Each implemented area gets a short local `README.md` that explains its boundary,
entry points, tests, and dependencies. Do not duplicate product rules there;
link back to the owning document.
