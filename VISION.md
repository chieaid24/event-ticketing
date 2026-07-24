# SeatFlow Vision

SeatFlow lets an organizer publish an event, lets a customer reserve and buy
assigned or general-admission inventory, and lets venue staff validate a QR
ticket exactly once. The system must preserve inventory, payment, refund, and
ticket correctness when requests race, repeat, arrive late, or fail midway.

This file is the standing direction for the project. Every issue, decision, and
pull request must align with it.

## Public repository

SeatFlow is developed in public. Treat source, history, issues, pull requests,
workflow logs, artifacts, screenshots, fixtures, and load reports as
internet-visible. Use synthetic data and safe placeholders. Store credentials
and production configuration outside GitHub. Follow [SECURITY.md](SECURITY.md),
rotate any exposed value immediately, and use private vulnerability reporting
for sensitive findings.

## Outcome

Build a production-style TypeScript platform that demonstrates:

- secure authentication and organization-scoped authorization;
- PostgreSQL transactions that prevent double booking and overselling;
- expiring holds, idempotent checkout, and verified Stripe webhooks;
- reliable background work through an outbox and retryable jobs;
- unguessable QR tickets with atomic check-in;
- accessible customer, organizer, scanner, and administrator experiences;
- observable behavior, failure recovery, and reproducible deployment; and
- measured concurrency and load results without invented claims.

## Priority order

Resolve conflicts in this order:

1. Security and data integrity
2. Prevention of overselling and double booking
3. Correct payment and refund state
4. Auditability and observability
5. Accessibility and user experience
6. Performance
7. Implementation convenience

PostgreSQL is authoritative for inventory and order state. Redis accelerates
coordination but never decides whether inventory is sold. The browser never
decides price, permission, availability, total, user identity, payment state, or
ticket state.

## Scope

The first complete release includes authentication, organizations, venue and
event management, assigned and general-admission inventory, expiring holds,
Stripe test-mode checkout, tickets, scanning, refunds, notifications, analytics,
audit logs, rate limits, tests, local containers, CI, and deployment
documentation.

Build the waiting room only after normal inventory and checkout are stable.
Defer transfers, resale, dynamic pricing, multi-currency, native mobile apps,
offline scanning, tax integrations, and multi-region inventory writes.

## Autonomous development

Agents perform all repository work through the dependency-aware GitHub Issues
queue.

- Label work `afk` by default. An agent plans, implements, tests, documents,
  opens a pull request, fixes CI, squash-merges, and cleans up without waiting
  for routine human review.
- Use `hitl` only when a person must provide credentials, approve external
  spending, make a legal or financial policy decision, or authorize an
  irreversible external action.
- Do not use `hitl` because work is difficult, broad, or unfamiliar.
- Continue unrelated autonomous work when an external dependency is blocked.
- Record durable architectural choices in `docs/adr/`.
- Update the relevant specification in the same pull request as behavior.
- Report actual commands and results. Never claim a check ran when it did not.

## Engineering rules

- Build vertical slices that leave the system runnable.
- Keep controllers thin and put business rules in domain services.
- Validate external input at frontend, API, domain, and database boundaries.
- Use explicit state transitions and stable error codes.
- Keep provider calls outside inventory transactions.
- Require idempotency for externally retried, high-impact mutations.
- Keep secrets, session tokens, reset tokens, raw QR values, and payment
  payloads out of logs and committed files.
- Add unit, integration, end-to-end, concurrency, security, and load tests at
  the seams where each type provides evidence.
- Meet WCAG 2.2 AA where practical and provide nonvisual alternatives to the
  seating map.
- Pin dependencies and container images.

## Definition of done

An issue closes only when its acceptance criteria are demonstrated, CI is green,
affected docs are current, security and failure behavior are covered,
observability is sufficient to operate the change, and no known critical
correctness failure remains.

A phase completes only when the application is runnable and its required tests
have been observed passing. A release completes only when concurrency tests show
zero double bookings and zero overselling, payment and webhook retries are
idempotent, refunded tickets cannot scan, and deployment and recovery procedures
are reproducible.
