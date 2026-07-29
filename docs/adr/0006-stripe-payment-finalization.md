# ADR 0006: Stripe Payment Finalization

## Status

Accepted

## Context

Checkout must create one immutable order per hold, collect payment through
Stripe, and mark inventory sold only after verified backend processing. Payments
race against hold expiry, webhooks arrive late, duplicated, and out of order,
and no Stripe credential exists in development or CI. The browser, the redirect
back from the provider, and the webhook payload all carry values an attacker can
replay or forge.

## Decision

Arbitrate "one order per hold" with a unique `orders.hold_id` column: duplicate
checkouts insert with `ON CONFLICT DO NOTHING` and replay the winner under the
hold's row lock. The checkout transaction snapshots server-calculated prices
from the hold and commits before any provider call. The PaymentIntent is then
created under the stable idempotency key `order:<id>`, so crashes and retries
converge on one logical intent, and a different intent for an order that already
has one is rejected rather than replaced.

Isolate the provider behind a `PaymentGateway` interface in
`@event-ticketing/payments` with two implementations: the Stripe SDK, and a
deterministic in-process fake that derives identifiers from the idempotency key.
Both share one webhook path: signatures verify against the raw body with one
implementation of Stripe's `t`/`v1` HMAC scheme, every verified event is durably
recorded under a unique `(provider, provider_event_id)` receipt, and the
processing request enqueues to the outbox in the same transaction with the event
id as its deduplication key. The fake provider's outcomes arrive as signed
simulated deliveries through the production endpoint, never through a shortcut.

Finalize asynchronously in the worker. The handler locks the payment, order,
hold, ticket types, and seats, re-verifies amount and currency against the
stored order, and then either secures every unit and issues one ticket per unit,
or - when any unit is lost - records `payment_conflict`, frees what the hold
still occupies, and enqueues an idempotent full refund (`refund:order:<id>`)
plus customer and operations notifications. Units are never partially secured
and seats are never substituted.

A hold that starts checkout keeps its inventory for a payment grace window
(`CHECKOUT_GRACE_SECONDS`) beyond expiry before the sweep frees it. A payment
that succeeds later still delivers when every unit is reattachable at
finalization time; otherwise the conflict path compensates.

## Consequences

- Duplicate checkouts, webhook redeliveries, and worker retries each converge on
  one order, one logical intent, and one ticket set.
- Commercial state changes only inside verified, locked finalization; browser
  callbacks and redirect parameters prove nothing.
- Development and CI exercise the full verification, receipt, and finalization
  path without Stripe credentials; validating the live Stripe test-mode journey
  remains a human-gated task.
- A paid order can briefly reference inventory another customer released and
  reclaimed; the conflict path then refunds in full rather than substituting
  seats.
- Abandoned checkouts hold inventory up to expiry plus the grace window, a
  deliberate trade against refunding successful payments during normal webhook
  latency.
