#!/bin/sh
set -eu

if [ "$#" -ne 6 ]; then
  printf 'Usage: %s CLUSTER WEB_SERVICE API_SERVICE WORKER_SERVICE IMAGE_URI SMOKE_URL\n' "$0" >&2
  exit 64
fi

cluster="$1"
web_service="$2"
api_service="$3"
worker_service="$4"
image_uri="$5"
smoke_url="$6"

case "$image_uri" in
  *@sha256:????????????????????????????????????????????????????????????????) ;;
  *)
    printf 'IMAGE_URI must contain a sha256 digest\n' >&2
    exit 64
    ;;
esac

register_image() {
  service="$1"
  current_definition="$(
    aws ecs describe-services \
      --cluster "$cluster" \
      --services "$service" \
      --query 'services[0].taskDefinition' \
      --output text
  )"

  aws ecs describe-task-definition \
    --task-definition "$current_definition" \
    --query taskDefinition \
    --output json |
    jq --arg image "$image_uri" '
      .containerDefinitions |= map(
        if .name == "application" then .image = $image else . end
      )
      | del(
          .compatibilities,
          .enableFaultInjection,
          .registeredAt,
          .registeredBy,
          .requiresAttributes,
          .revision,
          .status,
          .taskDefinitionArn
        )
    ' |
    aws ecs register-task-definition \
      --cli-input-json file:///dev/stdin \
      --query 'taskDefinition.taskDefinitionArn' \
      --output text
}

web_definition="$(register_image "$web_service")"
api_definition="$(register_image "$api_service")"
worker_definition="$(register_image "$worker_service")"

api_network="$(
  aws ecs describe-services \
    --cluster "$cluster" \
    --services "$api_service" \
    --query 'services[0].networkConfiguration.awsvpcConfiguration' \
    --output json |
    jq -c '{awsvpcConfiguration: .}'
)"

migration_task="$(
  aws ecs run-task \
    --cluster "$cluster" \
    --task-definition "$api_definition" \
    --launch-type FARGATE \
    --network-configuration "$api_network" \
    --overrides '{"containerOverrides":[{"name":"application","command":["migrate"]}]}' \
    --query 'tasks[0].taskArn' \
    --output text
)"

if [ "$migration_task" = "None" ] || [ -z "$migration_task" ]; then
  printf 'ECS did not start the migration task\n' >&2
  exit 1
fi

aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$migration_task"
migration_exit_code="$(
  aws ecs describe-tasks \
    --cluster "$cluster" \
    --tasks "$migration_task" \
    --query 'tasks[0].containers[?name==`application`].exitCode | [0]' \
    --output text
)"

if [ "$migration_exit_code" != "0" ]; then
  printf 'Migration task failed with exit code %s\n' "$migration_exit_code" >&2
  exit 1
fi

aws ecs update-service \
  --cluster "$cluster" \
  --service "$web_service" \
  --task-definition "$web_definition" \
  --force-new-deployment >/dev/null
aws ecs update-service \
  --cluster "$cluster" \
  --service "$api_service" \
  --task-definition "$api_definition" \
  --force-new-deployment >/dev/null
aws ecs update-service \
  --cluster "$cluster" \
  --service "$worker_service" \
  --task-definition "$worker_definition" \
  --force-new-deployment >/dev/null

aws ecs wait services-stable \
  --cluster "$cluster" \
  --services "$web_service" "$api_service" "$worker_service"

curl --fail --show-error --silent \
  --retry 5 \
  --retry-all-errors \
  --retry-delay 10 \
  "${smoke_url%/}/health/ready" >/dev/null

printf 'Deployed %s to %s\n' "$image_uri" "$cluster"
