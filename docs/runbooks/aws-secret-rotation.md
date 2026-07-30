# Rotate AWS Runtime Secrets

Use this runbook for scheduled rotation or suspected exposure of Stripe, SMTP,
payment webhook, waiting-room, or database credentials.

## Prerequisites

- authorized provider and AWS access
- application secret ARN
- ECS cluster and service names
- public environment URL
- a mode `0600` JSON file outside the repository

Rotate the provider credential first. Update the complete JSON document, not one
field, because Secrets Manager stores the application configuration as one
version.

```bash
aws secretsmanager put-secret-value \
  --secret-id "$APPLICATION_SECRET_ARN" \
  --secret-string "file://$RUNTIME_SECRET_FILE" >/dev/null
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_API_SERVICE" \
  --force-new-deployment >/dev/null
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_WORKER_SERVICE" \
  --force-new-deployment >/dev/null
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_API_SERVICE" "$ECS_WORKER_SERVICE"
curl --fail --show-error --silent "${PUBLIC_ORIGIN%/}/health/ready" >/dev/null
```

Verify one synthetic provider action for the credential you changed. Revoke the
old provider credential only after the new ECS tasks pass readiness and the
provider action succeeds.

If verification fails, move `AWSPREVIOUS` back to `AWSCURRENT` with
`aws secretsmanager update-secret-version-stage`, redeploy both services, and
investigate before revoking either credential.

Record the secret name, version IDs, service revisions, checks, and UTC times.
Never record secret values, authorization headers, provider payloads, or private
endpoints.
