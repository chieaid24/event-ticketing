# Roll Back an Azure Release

Use this runbook when a promoted revision fails after deployment or causes a
customer-impacting regression. The deployment script blocks unhealthy revisions
during rollout; this procedure restores the last known-good image digest after a
release has stabilized.

## Prerequisites

- authorized Azure CLI session for the affected environment
- environment resource group and web, API, and worker app names
- last known-good image digest
- public environment URL

Do not roll back across a destructive database migration. Prefer a forward fix
when the previous application cannot read the current schema.

## Redeploy the previous digest

Find the digest each app ran before the regression:

```bash
az containerapp revision list \
  --resource-group "$RESOURCE_GROUP" \
  --name "$API_APP" \
  --query '[].{revision: name, image: properties.template.containers[0].image}' \
  --output table
```

Move every app back to that digest; each update creates a new revision from the
known-good bytes:

```bash
az containerapp update \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WEB_APP" \
  --image "$GOOD_IMAGE_URI" >/dev/null
az containerapp update \
  --resource-group "$RESOURCE_GROUP" \
  --name "$API_APP" \
  --image "$GOOD_IMAGE_URI" >/dev/null
az containerapp update \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WORKER_APP" \
  --image "$GOOD_IMAGE_URI" >/dev/null
curl --fail --show-error --silent "${PUBLIC_ORIGIN%/}/health/ready" >/dev/null
```

Verify login, event discovery, one synthetic hold, and worker queue progress.
Confirm that error rate, latency, dead letters, and database saturation return
to their prior ranges.

Record the workflow run, restored revisions, reason, checks, and UTC times. Do
not record customer data, private endpoints, or configuration values.
