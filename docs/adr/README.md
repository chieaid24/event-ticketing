# Architecture Decision Records

Create an ADR when a decision is hard to reverse, surprising without context,
and based on a real trade-off.

Use the next four-digit number and a concise slug:

```text
docs/adr/0001-monorepo-and-service-boundaries.md
```

Each ADR contains:

1. Status
2. Context
3. Decision
4. Alternatives
5. Consequences
6. Security impact
7. Operational impact

Initial decisions expected during implementation cover service boundaries,
PostgreSQL inventory authority, locking, server-managed sessions, shared Zod
contracts, Stripe finalization, the transactional outbox, QR token design, the
waiting room, and AWS deployment.

Do not pre-write an accepted ADR before the implementation issue evaluates its
trade-offs. Link accepted ADRs from the relevant architecture document and
issue.
