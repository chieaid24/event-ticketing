# Azure Terraform

These roots create shared delivery resources and isolated staging and production
platforms in `eastus2` (a `location` variable on every root).

## Layout

| Path                      | Responsibility                                            |
| ------------------------- | --------------------------------------------------------- |
| `foundation`              | ACR, GitHub OIDC identities, build and deploy roles       |
| `environments/staging`    | Isolated staging network, data, and container apps        |
| `environments/production` | Isolated production network, data, and container apps     |
| `modules/network`         | VNet, delegated subnets, NSG, NAT Gateway, private DNS    |
| `modules/data`            | PostgreSQL, Managed Redis, blob storage, Key Vault, locks |
| `modules/platform`        | Front Door, WAF, container apps, email, logs, and alerts  |

Each root uses an `azurerm` backend with Entra ID authentication. Supply the
backend resource group, storage account, container, and key during
`terraform init`; do not commit backend coordinates or generated `tfvars`.

## Validate

```bash
terraform -chdir=infrastructure/terraform/foundation init -backend=false
terraform -chdir=infrastructure/terraform/foundation validate
terraform -chdir=infrastructure/terraform/environments/staging init -backend=false
terraform -chdir=infrastructure/terraform/environments/staging validate
terraform -chdir=infrastructure/terraform/environments/production init -backend=false
terraform -chdir=infrastructure/terraform/environments/production validate
```

The [deployment guide](../../docs/operations/aws-deployment.md) still describes
the previous AWS flow; its Azure rewrite lands with the documentation migration.
