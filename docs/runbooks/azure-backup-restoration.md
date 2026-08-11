# Restore an Azure Backup

Use this runbook to prove that a Flexible Server recovery point can create an
isolated database server and that a deleted artifact can be recovered. Never
replace the production server during a drill.

## Prerequisites

- authorized Azure CLI session
- source server resource ID and resource group
- a unique restore server name
- enough quota and approved temporary spend

## Restore the database

Pick a restore time inside the 35-day retention window:

```bash
az postgres flexible-server restore \
  --resource-group "$RESOURCE_GROUP" \
  --name "$RESTORE_NAME" \
  --source-server "$SOURCE_SERVER_ID" \
  --restore-time "$RESTORE_TIME" >/dev/null
az postgres flexible-server show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$RESTORE_NAME" \
  --query state \
  --output tsv
```

Poll the state until the server reports `Ready`. The restored server keeps the
source's private network integration and accepts no public traffic.

Connect from an isolated one-off container apps job. Run
`prisma migrate status`, count synthetic reference records, and verify schema
constraints without sending email, payment, or webhook traffic. Do not attach
production apps.

## Recover an artifact

Blob soft delete retains deleted artifacts for 30 days, and versioning keeps
noncurrent versions for 90 days. Undelete a removed blob, or restore earlier
content with `az storage blob copy start` and its `--source-blob-version-id`:

```bash
az storage blob undelete \
  --auth-mode login \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name artifacts \
  --name "$BLOB_NAME"
```

Delete the restored server after retaining the source server ID, restore time,
duration, checks, and UTC times. Retain no query results, credentials, or
private endpoints.
