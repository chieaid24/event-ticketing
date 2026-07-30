# Retry a dead-letter job

Retry one dead-letter job only after you identify and correct its failure. The
retry keeps the job ID and handler idempotency key, resets its attempt budget,
and records `job.retried` in the audit log.

## Trigger and impact

Start this runbook when the Operations page reports a `dead_letter` job or an
alert identifies repeated worker failures. The asynchronous effect represented
by that job has stopped. Related checkout, refund, notification, or maintenance
work may remain incomplete.

## Prerequisites

You need:

- owner or administrator membership for an organization-scoped job, or platform
  administrator access for a platform job;
- access to structured API and worker logs;
- the job ID, topic, error code, and `updatedAt` value from the job view; and
- authority to correct the underlying provider or configuration failure.

Do not copy a job payload, credential, customer email, QR value, cookie, or
authorization header into an incident record.

## Check

1. Find `outbox.cycle.failed` and related topic logs near the dead-letter time.
2. Correlate API activity with `request_id` or `trace_id` when the job began
   from an HTTP request.
3. Confirm the dependency health and configuration named by the stable error
   code.
4. Check whether the provider already completed the side effect. Handlers use
   the job ID as their idempotency key, so a retry must reuse the existing job.

## Mitigate

Correct the dependency, configuration, or handler condition first. Then retry
the job from the organization's Operations page.

For an API-driven platform retry, send the last observed timestamp:

```bash
curl --fail-with-body \
  --request POST \
  --header 'content-type: application/json' \
  --header 'x-csrf-token: <csrf-token>' \
  --cookie 'et_session=<session>; et_csrf=<csrf-token>' \
  --data '{"expectedUpdatedAt":"<updated-at>"}' \
  'https://<api-host>/admin/jobs/<job-id>/retry'
```

A `409 job_conflict` means the job changed. Reload it before deciding whether to
retry. A `409 job_not_retryable` means a worker or another operator already
moved it out of the dead-letter state.

## Verify

1. Confirm the job moves to `pending`, then `processing`, then `completed`.
2. Confirm its attempt count restarts and no new dead letter appears.
3. Verify the domain effect, such as a provider refund or notification, once.
4. Confirm the audit log contains `job.retried` with the operator and job ID.
5. Watch API error rate and worker cycle logs for 15 minutes.

## Roll back and escalate

There is no safe manual rollback after a handler completes. Rely on the
handler's idempotency key and the provider's reconciliation path.

Escalate when the job dead-letters again, the provider state disagrees with the
database, the job has no organization scope, or retrying could repeat a
non-idempotent external effect. Preserve job metadata, stable error codes,
request and trace IDs, timestamps, and the commands used. Do not preserve
secrets or full payloads.
