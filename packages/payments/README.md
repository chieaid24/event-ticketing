# @event-ticketing/payments

Provider boundary for payment side effects.

## Responsibility

- Define the `PaymentGateway` interface the API and worker call for payment
  intents and refunds.
- Implement the interface for Stripe and for a deterministic in-process fake
  used in development and CI, where no Stripe credential exists.
- Verify and build webhook signature headers with one shared implementation of
  Stripe's `t=<ts>,v1=<hmac>` scheme, so simulated deliveries exercise the
  production verification path.
- Parse the provider-shaped payment event slice that finalization consumes.

## Non-responsibilities

- Deciding commercial state. Orders become paid only through verified webhook
  processing against PostgreSQL (see
  [inventory and checkout](../../docs/architecture/inventory-and-checkout.md)).
- Storing anything. The database package owns orders, payments, and webhook
  receipts.

## Entry points

- `createPaymentGateway(config)` selects the provider from configuration.
- `verifyWebhookSignatureHeader` / `buildWebhookSignatureHeader`
- `parsePaymentProviderEvent`, `isHandledPaymentEventType`
- `buildFakePaymentEvent` for simulated deliveries and tests

## Dependencies

`stripe` (server SDK) and `zod`. Consumed by `apps/api` and `apps/worker`.

## Tests

`pnpm --filter @event-ticketing/payments test` covers signature round-trips,
tamper and staleness rejection, fake-gateway determinism, and event parsing.
