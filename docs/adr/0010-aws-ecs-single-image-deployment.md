# ADR 0010: AWS ECS Single-Image Deployment

## Status

Accepted

## Context

The web, API, and worker have different runtime responsibilities but come from
one monorepo and one release. Rebuilding any role between staging and production
would make staging evidence describe different bytes. Public services also need
internet ingress without giving application or data tasks public addresses.

## Decision

Build one container image per commit. Select the web, API, worker, or migration
role through the container command. Push the image to one immutable Elastic
Container Registry repository and deploy it by digest.

Run separate web and API CloudFront distributions through one AWS WAF and
Application Load Balancer. The API distribution adds an origin-routing header,
which avoids collisions between web pages and API routes that share paths. Place
the load balancer in public subnets, ECS Fargate tasks in private application
subnets, and RDS PostgreSQL and ElastiCache Valkey in private data subnets. Keep
PostgreSQL authoritative for inventory and orders. Use Valkey only for the
existing Redis acceleration and queue responsibilities.

Deploy with GitHub Actions OpenID Connect roles. Run migrations and readiness
checks in staging before the production GitHub environment can promote the same
digest. The production environment is the approval boundary for spending and
irreversible external changes.

## Alternatives

Separate images would remove unused application files from each runtime, but
they would create three build identities and a wider promotion matrix. Public
ECS tasks would avoid NAT gateways, but each task would receive an internet
route and a public address. Kubernetes would add scheduling features that this
three-service release does not use.

## Consequences

- One digest identifies the complete release in both environments.
- ECS task definitions still give each role separate commands, IAM roles,
  secrets, ports, health checks, and scaling policies.
- The image is larger than a role-specific image.
- Each environment pays for one NAT gateway per Availability Zone to avoid a
  shared egress failure.
- An operator must populate runtime secrets and publish the first image before
  creating ECS services.

## Security impact

Application and data subnets do not assign public addresses. Security groups
allow data access only from ECS tasks and load-balancer ingress only from the
CloudFront origin prefix list. KMS encrypts data stores, secrets, logs, backups,
and images. GitHub receives temporary AWS credentials through OpenID Connect;
the repository stores no AWS access keys.

## Operational impact

The deployment waits for a successful one-off migration, stable ECS services,
and API readiness in each environment. ECS deployment circuit breakers roll back
failed service replacements. AWS Backup covers RDS and S3, while dedicated
runbooks define rollback, restoration, and secret rotation.
