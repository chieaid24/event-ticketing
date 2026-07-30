# Runbooks

Add an executable runbook with the feature that introduces an operational
failure mode. Start from the requirements in
[the runbook index](../operations/runbook-index.md).

Do not put secrets, private endpoints, customer data, or undisclosed incident
details in this public repository.

## Available runbooks

- [Inspect and redeliver outbox dead letters](outbox-dead-letters.md)
- [Recover a refund webhook backlog](refund-webhook-backlog.md)
- [Retry a dead-letter job](dead-letter-jobs.md)
