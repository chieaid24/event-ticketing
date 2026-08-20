# Deploy to Azure

Create the shared delivery resources first, then create each isolated
environment. The initial environment bootstrap needs authorized Azure access
because the container apps cannot start until Key Vault secrets and a first
image digest exist.

## Prerequisites

- Terraform 1.10 or newer
- Azure CLI
- Docker with BuildKit
- an Azure Storage state container with versioning, Entra ID authorization, and
  public access blocked
- owner-approved Azure subscription, region, domain, and spend

Keep all state coordinates, generated plans, credentials, resource identifiers,
and secret files outside Git. The checked-in examples contain placeholders only.

## Create shared delivery resources

Set `registry_name` to a globally unique value (5-50 alphanumeric characters);
verify it with `az acr check-name --name <name>` before applying.

```bash
terraform -chdir=infrastructure/terraform/foundation init \
  -backend-config="resource_group_name=$TF_STATE_RESOURCE_GROUP" \
  -backend-config="storage_account_name=$TF_STATE_ACCOUNT" \
  -backend-config="container_name=$TF_STATE_CONTAINER" \
  -backend-config="key=event-ticketing/foundation.tfstate"
terraform -chdir=infrastructure/terraform/foundation plan -out="$TF_PLAN"
terraform -chdir=infrastructure/terraform/foundation apply "$TF_PLAN"
terraform -chdir=infrastructure/terraform/foundation output
```

Leave `deployment_scopes` empty until the environment resource groups exist.
Record the registry login server and the identity client IDs in private
deployment configuration. Add repository variables `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `AZURE_CLIENT_ID_BUILD`, `ACR_NAME`, and
`ACR_REPOSITORY`.

## Publish the bootstrap image

Build the same Dockerfile used by GitHub Actions. Push one commit tag, then use
the registry-reported digest as `image_uri`:

```bash
az acr login --name "$ACR_NAME"
docker build \
  --file infrastructure/container/Dockerfile \
  --tag "$ACR_NAME.azurecr.io/$ACR_REPOSITORY:$GIT_COMMIT" \
  .
docker push "$ACR_NAME.azurecr.io/$ACR_REPOSITORY:$GIT_COMMIT"
az acr repository show \
  --name "$ACR_NAME" \
  --image "$ACR_REPOSITORY:$GIT_COMMIT" \
  --query digest \
  --output tsv
```

Do not rebuild or retag the image for production. Use
`$ACR_NAME.azurecr.io/$ACR_REPOSITORY@$IMAGE_DIGEST`.

## Create an environment

Copy the environment's `terraform.tfvars.example` to an ignored file outside the
repository. Replace every placeholder, including separate web `public_origin`
and API `api_origin` names. First create the network and data layers:

```bash
terraform -chdir="$TF_ROOT" init \
  -backend-config="resource_group_name=$TF_STATE_RESOURCE_GROUP" \
  -backend-config="storage_account_name=$TF_STATE_ACCOUNT" \
  -backend-config="container_name=$TF_STATE_CONTAINER" \
  -backend-config="key=$TF_STATE_KEY"
terraform -chdir="$TF_ROOT" apply \
  -target=module.network \
  -target=module.data \
  -var-file="$TF_VARS"
```

Use the `database_fqdn` output, the `platform_admin` login, and the
`postgres-admin-password` vault secret to create a least-privilege application
user in the `event_ticketing` database. The server and vault accept only private
traffic, so run these steps from a network path with access to the environment's
virtual network.

Populate one Key Vault secret per runtime value from mode `0600` files outside
the repository, without printing the values. Terraform manages `redis-url`; an
operator sets the rest. Take the vault name from the `key_vault_uri` output:

```bash
for secret in database-url payment-webhook-secret smtp-url \
  stripe-publishable-key stripe-secret-key waiting-room-token-secret; do
  az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "$secret" \
    --file "$SECRET_DIR/$secret" >/dev/null
done
```

Review the complete plan, then create the platform:

```bash
terraform -chdir="$TF_ROOT" plan \
  -var-file="$TF_VARS" \
  -out="$TF_PLAN"
terraform -chdir="$TF_ROOT" apply "$TF_PLAN"
```

The platform module wires the environment's Front Door profile GUID into the API
container app as `API_FRONT_DOOR_PROFILE_ID`. With that variable set, the API
rejects requests whose `X-Azure-FDID` header does not match, so traffic from any
other Front Door profile stops at the API even though the
`AzureFrontDoor.Backend` service tag admits it. Health probes and the metrics
scrape bypass Front Door and stay exempt; local development leaves the variable
unset, which disables verification.

Re-apply the foundation with `deployment_scopes` pointing at the environment
resource group so the matching deploy identity can manage it.

Add `AZURE_CLIENT_ID_DEPLOY`, `AZURE_RESOURCE_GROUP`, `ACA_WEB_APP`,
`ACA_API_APP`, `ACA_WORKER_APP`, `ACA_MIGRATE_JOB`, and `SMOKE_URL` to the
matching GitHub environment. The container apps are named `web`, `api`, and
`worker`, and the migration job is named `migrate`. Point `SMOKE_URL` at the API
Front Door endpoint. Require approval on the production environment.

## Automated promotion

Every push to `main` runs the workflow's `lint` and `validate` jobs, which
shellcheck `scripts/deploy-container-apps.sh` and validate the staging and
production Terraform without contacting Azure. The `build`, `staging`, and
`production` jobs stay skipped until the `AZURE_CLIENT_ID_BUILD` and
`AZURE_CLIENT_ID_DEPLOY` repository variables are set, so the pipeline never
fails or deploys before Azure exists.

`.github/workflows/deploy.yml` reuses the digest of an existing commit-tagged
image or builds and pushes one with provenance and SBOM attestations. The
staging job runs `scripts/deploy-container-apps.sh`, which moves the migrate job
to the digest, starts one migration execution and waits for `Succeeded`, updates
the web, API, and worker apps, waits for each new revision to run the promoted
digest and report healthy, and checks `/health/ready`. The production job
receives that same digest only after staging succeeds and the production
environment approves it.

Retain the workflow run, migration execution name, revision names, and smoke
result as deployment evidence. Do not retain environment values, private
endpoints, or secret payloads.
