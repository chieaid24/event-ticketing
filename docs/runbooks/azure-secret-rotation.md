# Rotate Azure Runtime Secrets

Use this runbook for scheduled rotation or suspected exposure of Stripe, SMTP,
payment webhook, waiting-room, or database credentials.

## Prerequisites

- authorized provider and Azure access
- environment key vault name
- environment resource group and API and worker app names
- public environment URL
- a mode `0600` value file outside the repository

Rotate the provider credential first and keep both credentials valid during the
rollout. Each runtime value is its own Key Vault secret (`database-url`,
`payment-webhook-secret`, `redis-url`, `smtp-url`, `stripe-publishable-key`,
`stripe-secret-key`, `waiting-room-token-secret`); write only the secret you
rotated as a new version:

```bash
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "$SECRET_NAME" \
  --file "$RUNTIME_SECRET_FILE" >/dev/null
for app in "$API_APP" "$WORKER_APP"; do
  revision="$(
    az containerapp show \
      --resource-group "$RESOURCE_GROUP" \
      --name "$app" \
      --query properties.latestRevisionName \
      --output tsv
  )"
  az containerapp revision restart \
    --resource-group "$RESOURCE_GROUP" \
    --name "$app" \
    --revision "$revision" >/dev/null
done
curl --fail --show-error --silent "${PUBLIC_ORIGIN%/}/health/ready" >/dev/null
```

The apps reference each vault secret without a pinned version, so the restart
resolves the newest version through the application identity.

Verify one synthetic provider action for the credential you changed. Revoke the
old provider credential only after the restarted apps pass readiness and the
provider action succeeds.

If verification fails, write the previous version's value back as a new current
version (`az keyvault secret list-versions` identifies it), restart both apps
again, and investigate before revoking either credential.

Record the secret name, version IDs, restarted revisions, checks, and UTC times.
Never record secret values, authorization headers, provider payloads, or private
endpoints.
