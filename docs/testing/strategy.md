# Testing Strategy

Test externally visible behavior at the highest practical seam. Use real
PostgreSQL and Redis for transactions, locks, expiry, and queue behavior.

## Unit tests

Cover schemas, money, authorization policies, transition guards, expiry, refund
eligibility, request hashing, token parsing and signing, and error mapping.

## Integration tests

Cover session lifecycle, CSRF, organization isolation, event creation,
assigned-seat locks, general-admission counters, expiration, checkout
idempotency, webhook deduplication, payment and refund finalization, ticket
issuance, atomic check-in, outbox claims, and worker retries.

Do not mock the database for locking tests.

The database baseline integration runner creates a unique PostgreSQL schema and
Redis key prefix for each run. It applies tracked migrations, runs the
deterministic seed twice, verifies both services, and removes the isolated data
in a `finally` cleanup. CI starts fresh pinned containers before invoking the
runner.

## Concurrency tests

- Race at least 100 attempts for one seat and require one winner.
- Race partially overlapping seat sets and prohibit partial success.
- Request more general-admission units than capacity and prohibit oversell.
- Race hold expiration with payment finalization and require one compensated or
  sold final state.
- Deliver duplicate webhooks concurrently and require one order transition and
  ticket set.
- Scan one ticket concurrently and require one acceptance.

Repeat races enough times to detect intermittent failures and record the
iteration count.

## End-to-end tests

Use Playwright for registration, organization and event creation, publication,
discovery, seat selection, conflicting browsers, Stripe test checkout, webhook
completion, QR display, scan and duplicate scan, refund, ticket voiding, and
cross-organization rejection.

## Security tests

Cover missing and invalid auth or CSRF, untrusted origins, ID substitution,
cross-organization access, role escalation, injection payloads, unsafe Markdown,
oversized bodies, invalid uploads, path traversal, reset reuse, session
fixation, idempotency key mismatch, invalid Stripe signatures, replayed queue
tokens, and QR rate limits.

## Load tests

Use k6 for catalog reads, event details, seating maps, queue joins, holds,
checkout starts, webhook bursts, and scanner bursts. Record p50, p95, p99,
throughput, errors, lock waits, connection use, Redis latency, conflict rate,
CPU, memory, and invariant violations.

Store scripts and dated reports in [docs/load-tests](../load-tests/). Include
environment, dataset, duration, virtual users, request mix, results,
bottlenecks, retest results, and limitations. Never present local results as
production capacity.

Run `pnpm --filter @event-ticketing/api test:waiting-room-load` against the
pinned local Redis service to measure 500 concurrent joins and atomic admission
under a 25-lease cap.

## Release verification

Run these suites with the pinned local services:

```bash
pnpm test:races
pnpm test:recovery
pnpm test:e2e
```

`test:races` repeats the isolated PostgreSQL and Redis integration suite. Set
`RACE_RUNS` from 1 through 20 when you need more repetitions. `test:recovery`
verifies migration history, transaction rollback, and a temporary
`pg_dump`/`pg_restore` database. `test:e2e` runs the Chromium release journey
and live HTTP security probes.

Run the public-read k6 scenario from the pinned container command in the
[release load report](../load-tests/2026-07-31-release-verification.md). Keep
authenticated mutation and provider-webhook load in a private environment that
can supply per-user sessions and provider secrets.

The [release verification report](2026-07-31-release-verification.md) records
the measured browser, security, concurrency, migration, rollback, and
restoration evidence.

## Repository tests

`pnpm test` validates documentation structure, naming, links, and workspace unit
behavior. The required CI `test` job also runs formatting, lint, strict type
checks, builds, isolated integration and race suites, recovery, Playwright
journeys, container smoke tests, and secret scanning.
