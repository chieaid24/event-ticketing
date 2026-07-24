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

## Repository tests

`pnpm test` validates documentation structure, naming, links, and workspace unit
behavior. The required CI `test` job also runs formatting, lint, strict type
checks, builds, and secret scanning. Later slices add migrations, OpenAPI,
integration tests, security tests, and selected smoke tests to the same gate.
