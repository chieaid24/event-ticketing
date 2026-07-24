# Delivery Roadmap

Each slice leaves SeatFlow runnable, adds tests with behavior, and updates the
owning documentation. GitHub blocked-by relationships, not this page, determine
the live ready set.

## Phase 0: Foundation

Create the pnpm and Turborepo workspace, Next.js web app, NestJS API, worker,
shared contracts, database package, strict TypeScript configuration, local
containers, validated configuration, structured logging, health endpoints, base
migrations, deterministic seeds, and CI.

Demonstrate one command starting dependencies, one command starting
applications, invalid configuration failing at startup, and CI passing.

## Phase 1: Identity and organizations

Deliver registration, verification, login, logout, reset, opaque sessions, CSRF,
membership invitations, organization RBAC, and audit events. Prove session
rotation and revocation, cross-organization isolation, and mutation CSRF.

## Phase 2: Venues and event drafts

Deliver venue and layout management, seat import or editing, ticket types, sale
windows, refund policies, media validation, event drafts, optimistic versions,
publish validation, and audit history.

## Phase 3: Public discovery

Deliver published-event listing and filtering, event details, assigned-seat
maps, general-admission selection, accessible alternatives, and advisory
availability reads.

## Phase 4: Inventory holds

Deliver assigned-seat and general-admission hold transactions, price snapshots,
idempotency, Redis TTL mirrors, delayed expiration, reconciliation sweeps,
cancellation, and concurrency tests.

## Phase 5: Checkout

Deliver one order per hold, Stripe PaymentIntents, Elements, durable webhook
receipt, signature verification, deduplication, payment finalization,
compensation, processing, and confirmation pages.

## Phase 6: Tickets and scanner

Deliver high-entropy QR tokens, ticket pages, artifact delivery, token rotation,
mobile scanner UX, event authorization, atomic check-in, duplicate results,
supervisor reversal, and scan audit history.

## Phase 7: Refunds and notifications

Deliver explicit refund policies, customer and organizer refunds, Stripe refund
webhooks, ticket voiding, inventory return policy, confirmations, reminders,
cancellation messages, retries, and deduplication.

## Phase 8: Analytics and operations

Deliver organization-isolated financial and operational metrics, aggregate jobs,
job inspection, audit views, logs, traces, metrics, alerts, and runbooks.

## Phase 9: Waiting room

Deliver queue join, signed tokens, heartbeats, admission leases, endpoint
enforcement, fairness documentation, metrics, and load tests. Keep PostgreSQL
locks authoritative.

## Phase 10: Production hardening

Deliver Terraform, AWS networking and services, WAF, secret references, backups,
autoscaling, immutable images, staging deployment, security scans, restore and
rollback drills, threat model review, and measured load reports.

## Demonstration

Show an organizer publishing assigned inventory, two customers racing for one
seat, one hold succeeding, a verified Stripe webhook issuing one QR ticket, one
scanner acceptance, one duplicate rejection, one eligible refund, ticket
voiding, accurate analytics, and a load report with zero double bookings.
