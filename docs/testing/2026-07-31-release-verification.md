# Release Verification - 2026-07-31

The controlled local release checks passed the product journey, live security
boundaries, repeated concurrency invariants, migrations, transaction rollback,
and backup restoration.

## Environment

I ran the checks on Linux 6.6 under WSL2 with an Intel Core Ultra 7 155H
available as 22 logical CPUs and 15 GiB of memory. The toolchain used Node.js
24.18.0, pnpm 11.17.0, Docker 29.3.1, Docker Compose 5.1.0, PostgreSQL 18.4,
Redis 8.8.1, and Chromium through Playwright 1.58.2. The branch started from
commit `54cf5f38056bdfa160bd4a3cc04035b4e01c48ca`.

The dataset came from the deterministic synthetic seed. It contained one
organization, one published event, eight assigned seats, and one
general-admission ticket type. No external credentials, account identifiers,
private endpoints, or customer data entered the run.

## Product journey

`pnpm test:e2e` completed three Chromium tests. The release journey signed in as
the synthetic owner, opened organizer venue and event surfaces, selected general
admission, created a hold and order, completed a fake-provider payment, opened
the issued ticket, rendered a rotated QR code, admitted the ticket, rejected a
duplicate scan, reversed the check-in, requested an owner-authorized refund,
rejected the refunded ticket at the scanner, and loaded reconciled analytics.

The two live HTTP security tests confirmed these boundaries:

- Protected reads returned `401` without a session.
- Missing CSRF tokens and untrusted origins returned `403`.
- A forged payment webhook returned `400`.
- An oversized JSON body returned `413`.
- Invalid typed input returned `400` before a database mutation.
- A missing organization returned the same opaque `404` shape used for tenant
  isolation.

The tests found no unresolved critical security failure. Unit and integration
coverage continues to cover role escalation, token hashing, idempotency, payment
signature verification, queue token signatures, scanner permissions, and
cross-organization access.

## Concurrency

I ran `RACE_RUNS=5 pnpm test:races`. All five isolated schemas completed in
23.479 seconds. Each run raced 100 attempts for one assigned seat and repeated
general-admission oversell, checkout, webhook, refund, scan, token, layout, and
outbox claims.

The 500 one-seat attempts produced five winners, zero double bookings, and zero
oversells. Every isolated schema and Redis key prefix was removed after its run.

## Migration and recovery

`pnpm test:recovery` confirmed all 14 tracked migrations were applied. A
transaction rollback probe left no organization row behind. The runner then
created a custom-format PostgreSQL backup, restored it into a generated
temporary database, and compared these source and restored row counts:

| Table         | Source | Restored |
| ------------- | -----: | -------: |
| Users         |      2 |        2 |
| Organizations |      1 |        1 |
| Events        |      1 |        1 |
| Orders        |      1 |        1 |
| Tickets       |      1 |        1 |
| Refunds       |      1 |        1 |

The runner removed the temporary database and backup file in its cleanup path.
The second user came from the API smoke test, while the order, ticket, and
refund came from the browser journey. These counts prove parity, not a
production dataset size.

## Limits

This run used the fake payment provider, local Mailpit, and local containers.
The live Stripe test-mode journey remains gated on owner-provided credentials.
AWS staging deployment, rollback, and managed backup restoration remain gated on
account access and spending approval. The local checks do not substitute for
those credentialed drills.

See the
[public-read load report](../load-tests/2026-07-31-release-verification.md) for
response-time measurements and the per-IP rate-limit bottleneck.
