# ADR 0010: Azure Container Apps Single-Image Deployment

## Status

Accepted

## Context

The web, API, and worker have different runtime responsibilities but come from
one monorepo and one release. Rebuilding any role between staging and production
would make staging evidence describe different bytes. Public services also need
internet ingress without giving application or data services public addresses.

## Decision

Build one container image per commit. Select the web, API, worker, or migration
role through the container arguments. Push the image to one Premium Azure
Container Registry and deploy it by digest.

Run the web, API, and worker as Azure Container Apps in one zone-redundant
Container Apps environment, plus a manual migrate job that applies migrations
before any service moves. Route separate web and API Front Door endpoints
through one Front Door WAF policy. The API route overwrites the
`X-Event-Ticketing-Origin` header, which avoids collisions between web pages and
API routes that share paths. Restrict container app ingress to Front Door origin
traffic, place PostgreSQL Flexible Server on a delegated private subnet with
zone-redundant high availability and built-in PgBouncer, and reach Azure Managed
Redis, Key Vault, and blob storage only through private endpoints. Keep
PostgreSQL authoritative for inventory and orders. Use Managed Redis only for
the existing Redis acceleration and queue responsibilities.

Resolve runtime secrets as Key Vault references through one user-assigned
identity, which also pulls images. Scale the web and API on KEDA HTTP
concurrency and the worker on claimable outbox backlog. Deploy with GitHub
Actions federated identity credentials. Run migrations and readiness checks in
staging before the production GitHub environment can promote the same digest.
The production environment is the approval boundary for spending and
irreversible external changes.

## Alternatives

Azure Kubernetes Service would add scheduling features that this three-service
release does not use. Separate images would remove unused application files from
each runtime, but they would create three build identities and a wider promotion
matrix. Public container app ingress without Front Door would drop the WAF, the
edge rate limit, and the origin-routing contract, and every app would accept
arbitrary internet traffic.

## Consequences

- One digest identifies the complete release in both environments.
- Container apps still give each role separate arguments, secrets, environment,
  probes, and scale rules.
- The image is larger than a role-specific image.
- Each environment routes outbound traffic through one NAT gateway with a stable
  public address.
- An operator must populate Key Vault secrets and publish the first image before
  creating the container apps.

## Security impact

Data services disable public network access; the database subnet is delegated,
and private DNS zones resolve every private endpoint inside the virtual network.
A network security group and per-app ingress restrictions admit only the
`AzureFrontDoor.Backend` service tag; the tag admits any Front Door profile, so
the API verifies `X-Azure-FDID` against the environment's own profile ID from
`API_FRONT_DOOR_PROFILE_ID` and rejects other profiles with `403` before any
route handling. Health probes and the private-network metrics scrape stay exempt
because they do not traverse Front Door. GitHub receives temporary Azure
credentials through federated identity credentials; the repository stores no
client secrets or access keys. Key Vault uses RBAC, purge protection, and soft
delete.

## Operational impact

The deployment updates the migrate job first and stops on a failed migration
with the previous revisions still serving traffic. Each app then receives the
digest, and the deployment waits for the new revision to run the promoted image
and report healthy before the API readiness check. Rollback redeploys the digest
of the last known-good revision. Flexible Server retains 35 days of backups,
blob versioning and soft delete cover artifacts, and management locks protect
both stores. Log Analytics receives platform logs, a Front Door alert fires on
sustained 5xx responses, and dedicated runbooks define rollback, restoration,
and secret rotation.
