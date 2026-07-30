# Deploy to AWS

Create the shared image repository first, then create each isolated environment.
The initial environment bootstrap needs authorized AWS access because ECS cannot
start until a runtime secret and first image digest exist.

## Prerequisites

- Terraform 1.10 or newer
- AWS CLI 2
- Docker with BuildKit
- an S3 state bucket with versioning, encryption, public access blocked, and
  native Terraform lockfile permissions
- owner-approved AWS account, region, domain, and spend

Keep all state coordinates, generated plans, credentials, resource identifiers,
and secret files outside Git. The checked-in examples contain placeholders only.

## Create shared delivery resources

```bash
terraform -chdir=infrastructure/terraform/foundation init \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=event-ticketing/foundation.tfstate" \
  -backend-config="region=$AWS_REGION"
terraform -chdir=infrastructure/terraform/foundation plan -out="$TF_PLAN"
terraform -chdir=infrastructure/terraform/foundation apply "$TF_PLAN"
terraform -chdir=infrastructure/terraform/foundation output
```

Record the ECR repository name, GitHub OIDC provider ARN, and build role ARN in
private deployment configuration. Add repository variables `AWS_REGION`,
`AWS_BUILD_ROLE_ARN`, and `ECR_REPOSITORY`.

## Publish the bootstrap image

Build the same Dockerfile used by GitHub Actions. Push one commit tag, then use
the registry-reported digest as `image_uri`:

```bash
docker build \
  --file infrastructure/container/Dockerfile \
  --tag "$ECR_REGISTRY/$ECR_REPOSITORY:$GIT_COMMIT" \
  .
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker push "$ECR_REGISTRY/$ECR_REPOSITORY:$GIT_COMMIT"
aws ecr describe-images \
  --repository-name "$ECR_REPOSITORY" \
  --image-ids "imageTag=$GIT_COMMIT" \
  --query 'imageDetails[0].imageDigest' \
  --output text
```

Do not rebuild or retag the image for production. Use
`$ECR_REGISTRY/$ECR_REPOSITORY@$IMAGE_DIGEST`.

## Create an environment

Copy the environment's `terraform.tfvars.example` to an ignored file outside the
repository. Replace every placeholder, including separate web `public_origin`
and API `api_origin` names. First create the network and data layers:

```bash
terraform -chdir="$TF_ROOT" init \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=$TF_STATE_KEY" \
  -backend-config="region=$AWS_REGION"
terraform -chdir="$TF_ROOT" apply \
  -target=module.network \
  -target=module.data \
  -var-file="$TF_VARS"
```

Use the outputs and the managed RDS master secret to create a least-privilege
application database user. Write this JSON to a mode `0600` file outside the
repository:

```json
{
  "DATABASE_URL": "postgresql://REDACTED",
  "PAYMENT_WEBHOOK_SECRET": "REDACTED",
  "SMTP_URL": "smtps://REDACTED",
  "STRIPE_PUBLISHABLE_KEY": "REDACTED",
  "STRIPE_SECRET_KEY": "REDACTED",
  "WAITING_ROOM_TOKEN_SECRET": "REDACTED"
}
```

Populate the created application secret without printing the values:

```bash
aws secretsmanager put-secret-value \
  --secret-id "$APPLICATION_SECRET_ARN" \
  --secret-string "file://$RUNTIME_SECRET_FILE" >/dev/null
```

Review the complete plan, then create the platform:

```bash
terraform -chdir="$TF_ROOT" plan \
  -var-file="$TF_VARS" \
  -out="$TF_PLAN"
terraform -chdir="$TF_ROOT" apply "$TF_PLAN"
```

Add `AWS_DEPLOY_ROLE_ARN`, `ECS_CLUSTER`, `ECS_WEB_SERVICE`, `ECS_API_SERVICE`,
`ECS_WORKER_SERVICE`, and `SMOKE_URL` to the matching GitHub environment.
Require approval on the production environment.

## Automated promotion

`.github/workflows/deploy.yml` builds and pushes one commit image. The staging
job registers task definitions with its digest, runs `prisma migrate deploy` as
a one-off Fargate task, waits for all three services, and checks
`/health/ready`. The production job receives that same digest only after staging
succeeds and the production environment approves it.

Retain the workflow run, task definition revisions, migration task result, and
smoke result as deployment evidence. Do not retain environment values, private
endpoints, or secret payloads.
