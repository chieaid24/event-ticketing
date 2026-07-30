# Roll Back an AWS Release

Use this runbook when a new ECS revision fails after deployment or causes a
customer-impacting regression. ECS circuit breakers handle startup failures;
this procedure restores the last known-good task definitions after a release has
stabilized.

## Prerequisites

- authorized AWS CLI session for the affected environment
- ECS cluster and web, API, and worker service names
- last known-good task definition ARN for each service
- public environment URL

Do not roll back across a destructive database migration. Prefer a forward fix
when the previous application cannot read the current schema.

## Restore task definitions

```bash
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_WEB_SERVICE" \
  --task-definition "$GOOD_WEB_TASK" >/dev/null
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_API_SERVICE" \
  --task-definition "$GOOD_API_TASK" >/dev/null
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_WORKER_SERVICE" \
  --task-definition "$GOOD_WORKER_TASK" >/dev/null
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_WEB_SERVICE" "$ECS_API_SERVICE" "$ECS_WORKER_SERVICE"
curl --fail --show-error --silent "${PUBLIC_ORIGIN%/}/health/ready" >/dev/null
```

Verify login, event discovery, one synthetic hold, and worker queue progress.
Confirm that error rate, latency, dead letters, and database saturation return
to their prior ranges.

Record the workflow run, restored task revisions, reason, checks, and UTC times.
Do not record customer data, private endpoints, or configuration values.
