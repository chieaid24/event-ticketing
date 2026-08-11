# Infrastructure

Use Docker Compose for local dependencies and Terraform for Azure staging and
production environments.

## Local services

```bash
pnpm services:up
docker compose ps
pnpm services:down
```

Run `pnpm services:reset` to stop the services and delete local volumes. This
removes the local database, Redis data, captured email, and MinIO objects.

## Endpoints

| Service    | Host endpoint           | Purpose                        |
| ---------- | ----------------------- | ------------------------------ |
| PostgreSQL | `127.0.0.1:5432`        | authoritative application data |
| Redis      | `127.0.0.1:6379`        | local coordination and queues  |
| Mailpit    | `http://127.0.0.1:8025` | captured development email     |
| MinIO      | `http://127.0.0.1:9000` | S3-compatible object API       |
| MinIO      | `http://127.0.0.1:9001` | local object console           |

Compose binds every port to loopback, pins every multi-architecture image by
release tag and digest, and waits for service health checks. The tracked
passwords are local-only placeholders. Do not reuse them in a shared or deployed
environment.

The [observability assets](observability/) provide Prometheus alert rules and a
Grafana dashboard for API traffic, failures, latency, dead letters, and outbox
backlog. Import them into the deployment monitoring stack; they are not loaded
by local Compose.

## Azure

The [Terraform configuration](terraform/) creates:

- delegated container-apps, database, and private-endpoint subnets with NAT
  egress and private DNS zones in each environment network;
- separate web and API Front Door endpoints, a Front Door WAF policy, and
  zone-redundant Container Apps for the web, API, and worker roles plus a manual
  migrate job;
- private zone-redundant PostgreSQL Flexible Server and Azure Managed Redis
  services;
- encrypted blob storage, Key Vault, Azure Container Registry, Log Analytics,
  and Azure Communication Services email resources; and
- GitHub OpenID Connect identities for image publication and environment
  deployment.

The [container definition](container/Dockerfile) builds one image that runs any
application role or a database migration. The deployment workflow identifies
that image by digest, migrates and verifies staging, then gives the production
GitHub environment the same digest.

The [deployment guide](../docs/operations/azure-deployment.md) describes
bootstrap order, secret population, and digest promotion. Use the
[runbook index](../docs/operations/runbook-index.md) for recovery and the
[security policy](../SECURITY.md) for public-repository constraints.
