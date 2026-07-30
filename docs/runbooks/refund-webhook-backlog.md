# Recover a Refund Webhook Backlog

Use this runbook when provider-pending refunds grow, the oldest pending refund
exceeds the alert threshold, or signed refund webhooks repeatedly fail.

## Impact

The provider may have moved money while the platform still shows a pending
refund. Tickets remain active and inventory remains unchanged until verified
finalization completes.

## Prerequisites

- PostgreSQL read access
- Payment provider dashboard access
- The deployed commit identifier
- An incident or maintenance record

Do not copy customer data, webhook bodies, or provider secrets into retained
evidence.

## Check

Count pending refunds by age:

```sql
SELECT
  count(*) AS "refunds",
  min("updated_at") AS "oldest_pending"
FROM "refunds"
WHERE "status" IN ('requested', 'provider_pending');
```

Inspect safe identifiers for the oldest requests:

```sql
SELECT
  "id",
  "status",
  "provider_refund_id",
  "amount_minor",
  "currency",
  "updated_at"
FROM "refunds"
WHERE "status" IN ('requested', 'provider_pending')
ORDER BY "updated_at", "id"
LIMIT 50;
```

Check worker logs for `refund.requested` and `refund.succeeded` failures. Check
webhook event and outbox status without printing payloads.

## Mitigate

For a `requested` refund, restore its failed `refund.requested` outbox event by
following [the dead-letter runbook](outbox-dead-letters.md). The stable provider
idempotency key makes the retry safe.

For a `provider_pending` refund, confirm the exact provider refund succeeded,
then ask the provider to redeliver its signed `refund.updated` event. Do not
manually mark the refund complete or edit tickets and inventory.

If the provider refund failed or was canceled, redeliver that signed terminal
update instead. The worker marks the request failed and releases its quantities
for a new request.

Redeliver one event first. Expand only after the refund reaches `succeeded` and
the worker remains healthy.

## Verify

Confirm the refund and its notifications:

```sql
SELECT
  r."id",
  r."status",
  r."completed_at",
  count(n."id") AS "notifications"
FROM "refunds" r
LEFT JOIN "notifications" n
  ON n."reference_id" = r."id"
WHERE r."id" = :'refund_id'
GROUP BY r."id";
```

Verify affected tickets are refunded, the order total reflects completed
refunds, and inventory changed only when the event's return window was open.
Confirm backlog count and oldest age decline without a matching rise in dead
letters.

## Roll back

Webhook finalization is a committed money and admission transition and cannot be
rolled back by editing rows. Stop further redelivery if validation fails,
preserve the signed provider event in its protected system, and escalate.

## Escalate

Escalate when provider state conflicts with stored amount or currency, the
provider reference is missing, ticket state does not follow a completed refund,
inventory changed outside policy, or a redelivered event fails again. Preserve
safe IDs, timestamps, counts, deployed commit, and observed error codes.
