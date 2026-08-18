# Stripe Test-Mode Verification - 2026-08-18

The live Stripe test-mode journey passed one successful payment, one declined
payment, and one refund, each driven through the real checkout interface and
finalized only by signed provider webhooks. This closes the credential-gated
limit recorded in the
[2026-07-31 release verification](2026-07-31-release-verification.md).

## Environment

I ran the checks on Linux 6.6 under WSL2 with Node.js 24.18.0, pnpm 11.17.0,
Docker 29.3.1, and Chromium through Playwright 1.58.2. The application ran with
`PAYMENT_PROVIDER=stripe` against the Stripe test-mode API. The repository owner
supplied test-mode credentials outside version control; the local environment
file stayed untracked and no credential entered the repository, logs, or this
report. Stripe CLI 1.50.1 forwarded provider events to `POST /webhooks/payments`
with a listener-scoped signing secret.

Every Stripe object in this run was a test-mode object. The balance endpoint
reported `livemode: false` before any journey started, and only documented
Stripe test card numbers were used. No real payment method existed in the
account.

## Journeys

A scripted Chromium session signed in as the synthetic owner and completed three
journeys against the seeded event:

- Successful payment: the checkout page rendered the real Payment Element,
  accepted the `4242` success card, confirmed against the Stripe API, and
  redirected through the processing page to a confirmed order. The signed
  `payment_intent.succeeded` webhook drove finalization: the order reached
  `paid` at US$19.50, exactly one ticket was issued, and the order confirmation
  email arrived in Mailpit.
- Declined payment: the `4000 0000 0000 0002` card returned a `402` decline from
  the provider, the checkout page surfaced the decline inline, the order stayed
  `pending_payment`, and no ticket was issued.
- Refund: an organizer refund request returned `202`, the worker created the
  provider refund, and the signed `refund.updated` webhook settled it. The
  refund reached `succeeded` for the full US$19.50, the order reached
  `refunded`, and the ticket reached `refunded`. The customer refund route
  correctly rejected the seeded event with `customer_refunds_disabled`, because
  the event does not accept customer refund requests.

Every webhook delivery returned `200` after signature verification against the
listener secret. Duplicate provider event types outside the handled set were
recorded and skipped without side effects.

## Leakage audit

After the journeys, the application logs contained no secret key, no publishable
key, no webhook signing secret, and no card number. The repository tree
contained no credential material. No exposure occurred, so no rotation was
required.

## Repairs shipped with this verification

Two development-environment defects blocked the journey and were fixed:

- Turborepo 2 strict environment mode silently dropped every variable from the
  local environment file, so `pnpm dev` always fell back to the fake payment
  provider. `turbo.json` now declares `globalPassThroughEnv` for the runtime
  configuration variables.
- A Next.js 16 development-only crash in React performance instrumentation
  (`performance.measure` with a negative timestamp, upstream
  vercel/next.js#86060) interrupted navigation after sign-in. The root layout
  now neutralizes that specific error in development builds only.

## Limits

This run verified the payment provider integration, not the deployment target.
Azure staging deployment, rollback, and managed backup restoration remain gated
on account access and spending approval. The Stripe account used is an
unactivated test-mode account; live-mode behavior, payment method activation,
and domain registration for wallet buttons remain out of scope.
