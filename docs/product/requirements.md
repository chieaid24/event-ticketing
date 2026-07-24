# Product Requirements

Event Ticketing Platform supports four actors through one event lifecycle.

## Customer

A customer can discover published events, inspect venue and inventory details,
select assigned seats or general-admission quantities, create an expiring hold,
pay through Stripe-hosted components, view orders and QR tickets, and request an
eligible refund.

The browser shows advisory availability and a server-synchronized countdown. The
hold API remains authoritative.

## Organizer

An organizer acts through an organization membership. Authorized members can
manage organizations, venues, seating layouts, event drafts, ticket types, sale
windows, refund policies, media, publication, exports, analytics, refunds, and
audit history.

Every organizer query is scoped to an organization. Role checks run on the
backend for each protected action.

## Venue staff

Authorized scanner staff can select an event, scan or manually enter a ticket,
receive a clear validation result, review recent activity, and reverse an
accidental check-in when their role permits it.

Check-in is an atomic state transition. A refunded, void, expired, wrong-event,
or already-used ticket is never accepted.

## Platform administrator

An administrator can investigate users, organizations, events, jobs, payments,
refunds, audit records, and platform health. Administrative mutations require
authorization, reason capture where appropriate, audit logging, and safe error
handling.

## Initial release

The first production-style release includes:

- registration, verification, login, logout, reset, and session management;
- organization memberships and resource-scoped RBAC;
- venue layouts, assigned seats, and general-admission ticket types;
- event drafting, validation, publication, discovery, and accessible maps;
- expiring transactional holds and availability refresh;
- idempotent orders, Stripe test-mode payments, and verified webhooks;
- QR ticket issuance, online validation, and atomic check-in;
- refunds, ticket voiding, inventory return policy, and notifications;
- analytics, audit logging, rate limits, logs, metrics, traces, and alerts;
- Dockerized local dependencies, CI, E2E and concurrency tests; and
- reproducible AWS deployment and recovery documentation.

## Deferred scope

Defer ticket transfers, resale, dynamic pricing, multiple currencies, tax
integrations, offline scanner mode, native applications, arbitrary HTML,
cryptocurrency, organizer payouts, and multi-region active-active inventory
writes.

The waiting room is an advanced slice after ordinary holds and checkout are
stable. It limits admission but never replaces database inventory locks.

## Public pages

Public routes cover event discovery and authentication. Authenticated routes
cover checkout, account, order, and ticket views. Organization routes cover
members, venues, events, inventory, orders, attendees, analytics, settings, and
refunds. Scanner and platform administration have separate route groups.

All pages handle loading, empty, stale, partial, error, and success states. Meet
WCAG 2.2 AA where practical. Provide a list or table alternative to the SVG
seating map.

## Acceptance

The release is accepted only when:

- concurrent holds never double book assigned seats;
- reserved plus sold general-admission quantity never exceeds capacity;
- expired holds cannot purchase;
- duplicate checkout, webhook, refund, and scan requests have one logical
  effect;
- the backend calculates price and enforces authorization;
- payment conflicts start compensation instead of leaving a charge without
  admission;
- refunded or void tickets cannot scan;
- staging deployment, rollback, backup, and restoration are reproducible; and
- measured reports support performance claims.
