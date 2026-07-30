# AWS Terraform

These roots create shared delivery resources and isolated staging and production
platforms in `us-east-1`. CloudFront-scoped AWS WAF resources require that
region.

## Layout

| Path                      | Responsibility                                        |
| ------------------------- | ----------------------------------------------------- |
| `foundation`              | ECR, GitHub OIDC provider, image-build role           |
| `environments/staging`    | Isolated staging network, data, and ECS platform      |
| `environments/production` | Isolated production network, data, and ECS platform   |
| `modules/network`         | Three subnet tiers, NAT, endpoints, and flow logs     |
| `modules/data`            | RDS, Valkey, S3, Secrets Manager, KMS, and backups    |
| `modules/platform`        | CloudFront, WAF, ALB, ECS, SES, logs, and autoscaling |

Each root uses an S3 backend with native lockfiles. Supply the backend bucket,
key, and region during `terraform init`; do not commit backend coordinates or
generated `tfvars`.

## Validate

```bash
terraform -chdir=infrastructure/terraform/foundation init -backend=false
terraform -chdir=infrastructure/terraform/foundation validate
terraform -chdir=infrastructure/terraform/environments/staging init -backend=false
terraform -chdir=infrastructure/terraform/environments/staging validate
terraform -chdir=infrastructure/terraform/environments/production init -backend=false
terraform -chdir=infrastructure/terraform/environments/production validate
```

See the [AWS deployment guide](../../docs/operations/aws-deployment.md) before
planning or applying an environment.
