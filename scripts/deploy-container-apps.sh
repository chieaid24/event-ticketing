#!/bin/bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  printf 'Usage: %s RESOURCE_GROUP WEB_APP API_APP WORKER_APP MIGRATE_JOB IMAGE_URI SMOKE_URL\n' "$0" >&2
  exit 64
fi

resource_group="$1"
web_app="$2"
api_app="$3"
worker_app="$4"
migrate_job="$5"
image_uri="$6"
smoke_url="$7"

case "$image_uri" in
  *@sha256:????????????????????????????????????????????????????????????????) ;;
  *)
    printf 'IMAGE_URI must contain a sha256 digest\n' >&2
    exit 64
    ;;
esac

# Migrations run before any service sees the new code; a failed migration
# stops the rollout with the previous revisions still serving traffic.
az containerapp job update \
  --resource-group "$resource_group" \
  --name "$migrate_job" \
  --image "$image_uri" >/dev/null

execution="$(
  az containerapp job start \
    --resource-group "$resource_group" \
    --name "$migrate_job" \
    --query name \
    --output tsv
)"

if [ -z "$execution" ]; then
  printf 'Container Apps did not start the migration job\n' >&2
  exit 1
fi

migration_status="Running"
for _ in $(seq 1 90); do
  migration_status="$(
    az containerapp job execution show \
      --resource-group "$resource_group" \
      --name "$migrate_job" \
      --job-execution-name "$execution" \
      --query properties.status \
      --output tsv
  )"
  case "$migration_status" in
    Succeeded | Failed | Stopped | Degraded) break ;;
  esac
  sleep 10
done

if [ "$migration_status" != "Succeeded" ]; then
  printf 'Migration execution %s ended as %s\n' "$execution" "$migration_status" >&2
  exit 1
fi

update_image() {
  app="$1"
  az containerapp update \
    --resource-group "$resource_group" \
    --name "$app" \
    --image "$image_uri" \
    --query properties.latestRevisionName \
    --output tsv
}

wait_healthy() {
  app="$1"
  revision="$2"
  for _ in $(seq 1 60); do
    read -r provisioning health revision_image <<<"$(
      az containerapp revision show \
        --resource-group "$resource_group" \
        --name "$app" \
        --revision "$revision" \
        --query '[properties.provisioningState, properties.healthState, properties.template.containers[0].image]' \
        --output tsv
    )"
    if [ "$revision_image" != "$image_uri" ]; then
      printf 'Revision %s of %s runs %s, not the promoted digest\n' \
        "$revision" "$app" "$revision_image" >&2
      return 1
    fi
    if [ "$provisioning" = "Provisioned" ] && [ "$health" = "Healthy" ]; then
      return 0
    fi
    if [ "$provisioning" = "Failed" ] || [ "$health" = "Unhealthy" ]; then
      printf 'Revision %s of %s is %s/%s\n' \
        "$revision" "$app" "$provisioning" "$health" >&2
      return 1
    fi
    sleep 10
  done
  printf 'Revision %s of %s did not become healthy\n' "$revision" "$app" >&2
  return 1
}

web_revision="$(update_image "$web_app")"
api_revision="$(update_image "$api_app")"
worker_revision="$(update_image "$worker_app")"

wait_healthy "$web_app" "$web_revision"
wait_healthy "$api_app" "$api_revision"
wait_healthy "$worker_app" "$worker_revision"

curl --fail --show-error --silent \
  --retry 5 \
  --retry-all-errors \
  --retry-delay 10 \
  "${smoke_url%/}/health/ready" >/dev/null

printf 'Deployed %s to %s\n' "$image_uri" "$resource_group"
