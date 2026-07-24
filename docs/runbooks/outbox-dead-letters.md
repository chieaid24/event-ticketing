# Inspect and Redeliver Outbox Dead Letters

Use this runbook when the worker reports a nonzero `deadLetter` count or an
`outbox.cycle.completed` log shows a new dead-letter transition.

## Impact

The failed asynchronous effect has stopped retrying. The domain transaction that
created the event remains committed. Related email, artifact, aggregate, or
provider work may be delayed until you fix the handler and redeliver the event.

## Prerequisites

- PostgreSQL access with permission to read and update outbox tables
- The deployed commit identifier
- The incident or maintenance record for retained evidence
- A confirmed fix or recovery for the handler's stable error code

Never copy event payloads into tickets, logs, or chat. Payloads may contain
organization or customer context.

## Check

Count failures by safe operational fields:

```sql
SELECT
  "topic",
  "last_error_code",
  count(*) AS "events",
  min("dead_lettered_at") AS "oldest_failure",
  max("dead_lettered_at") AS "newest_failure"
FROM "outbox_events"
WHERE "status" = 'dead_letter'
GROUP BY "topic", "last_error_code"
ORDER BY "oldest_failure";
```

List identifiers for one known failure class:

```sql
SELECT
  "id",
  "topic",
  "attempt_count",
  "last_error_code",
  "dead_lettered_at"
FROM "outbox_events"
WHERE "status" = 'dead_letter'
  AND "topic" = :'topic'
  AND "last_error_code" = :'error_code'
ORDER BY "dead_lettered_at", "id";
```

Confirm the handler is registered and the dependency or code failure is fixed.
Do not redeliver an unknown error class.

## Mitigate

Redeliver one verified event in a transaction:

```sql
BEGIN;

SELECT
  "id",
  "topic",
  "attempt_count",
  "last_error_code"
FROM "outbox_events"
WHERE "id" = :'event_id'
  AND "status" = 'dead_letter'
FOR UPDATE;

UPDATE "outbox_events"
SET
  "status" = 'pending',
  "attempt_count" = 0,
  "available_at" = clock_timestamp(),
  "last_error_code" = NULL,
  "dead_lettered_at" = NULL,
  "updated_at" = clock_timestamp()
WHERE "id" = :'event_id'
  AND "status" = 'dead_letter';

COMMIT;
```

Redeliver a small sample first. Expand the batch only after the sample completes
and the dependency remains healthy.

## Verify

Confirm the event reaches a terminal state:

```sql
SELECT
  "id",
  "status",
  "attempt_count",
  "last_error_code",
  "completed_at",
  "dead_lettered_at"
FROM "outbox_events"
WHERE "id" = :'event_id';
```

Check that `processing` returns to zero, `oldestReadyAgeSeconds` declines, and
no new failures appear for the same topic and error code. Verify the downstream
effect through its owning system without exposing payload data.

## Roll back

If the event is still pending and redelivery is unsafe, return it to
`dead_letter`:

```sql
UPDATE "outbox_events"
SET
  "status" = 'dead_letter',
  "last_error_code" = 'operator_paused',
  "dead_lettered_at" = clock_timestamp(),
  "updated_at" = clock_timestamp()
WHERE "id" = :'event_id'
  AND "status" = 'pending';
```

Do not force a processing or completed event backward. Use the domain's
compensation workflow if a completed external effect must be reversed.

## Escalate

Escalate when the error class is unknown, a redelivered sample fails again,
queue age continues to rise, or a provider may have accepted a request without
an idempotency key. Preserve the event ID, topic, stable error code, counts,
timestamps, deployed commit, commands, and observed results. Do not retain the
payload or raw provider response.
