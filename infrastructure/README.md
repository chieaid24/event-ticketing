# Infrastructure

Use Docker Compose for local dependencies and Terraform for AWS staging and
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

## AWS

The [Terraform configuration](terraform/) creates:

- public load-balancer subnets and private application and data subnets in at
  least two Availability Zones;
- separate web and API CloudFront distributions, AWS WAF, an Application Load
  Balancer, and private ECS Fargate services for the web, API, and worker roles;
- private Multi-AZ RDS PostgreSQL and ElastiCache Valkey services;
- encrypted S3, Secrets Manager, Elastic Container Registry, CloudWatch, Simple
  Email Service, and AWS Backup resources; and
- GitHub OpenID Connect roles for image publication and environment deployment.

The [container definition](container/Dockerfile) builds one image that runs any
application role or a database migration. The deployment workflow identifies
that image by digest, migrates and verifies staging, then gives the production
GitHub environment the same digest.

Start with the [AWS deployment guide](../docs/operations/aws-deployment.md). Use
the [runbook index](../docs/operations/runbook-index.md) for recovery and the
[security policy](../SECURITY.md) for public-repository constraints.
