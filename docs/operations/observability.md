# Observe the platform

Use request and trace identifiers to connect an HTTP failure to structured API
logs, then use metrics to decide whether the failure is isolated or systemic.

## Collect signals

Scrape `GET /metrics` from the API on the private service network. The endpoint
exports request counts and duration histograms with bounded method, normalized
path, and status labels. It also exports outbox state counts and the age of the
oldest ready job. Do not publish the endpoint through the customer-facing Front
Door endpoints.

Collect JSON logs from the API and worker. API completion entries include
`request_id` and `trace_id`. The API returns the same values in `x-request-id`
and `x-trace-id`. Send a W3C `traceparent` header to preserve a trace across an
upstream boundary.

The repository includes:

- [Prometheus alert rules](../../infrastructure/observability/alerts.yml)
- [Grafana dashboard](../../infrastructure/observability/dashboard.json)

Import both files into the monitoring stack during deployment. The local files
contain no account identifiers or private endpoints.

## Observe locally

`pnpm services:up` starts Prometheus at `http://127.0.0.1:9090` and Grafana at
`http://127.0.0.1:3001`. Prometheus scrapes the API through the Docker host
gateway every 15 seconds and evaluates the checked-in alert rules, so the
`event-ticketing-api` target reports `up` while `pnpm dev` runs and
`EventTicketingApiUnavailable` fires two minutes after the API stops. Grafana
provisions the Prometheus datasource and the checked-in dashboard at startup;
sign in with the local-only credentials in `compose.yaml`. Both services load
the same rule and dashboard files the deployed stack imports, so a threshold
change rehearses locally before it ships.

The host-gateway scrape resolves the API from inside a container. On a Docker
Engine without `host.docker.internal`, the target stays down unless the API
listens beyond loopback; CI never needs the scrape, so this only affects
watching metrics during local development.

## Read analytics

Open an organization's Operations page to reconcile paid orders, ticket counts,
fees, successful refunds, inventory, funnel activity, and check-ins. The
database appends one analytics event per source transition and updates UTC daily
projections in the same transaction.

Owners and administrators can inspect organization jobs and retry dead letters.
Event managers and finance members can read analytics. Platform administrators
can inspect jobs across organizations through `GET /admin/jobs`.

Job responses exclude payloads because payloads may contain customer or provider
references. A retry requires the last observed `updatedAt` value and fails when
another operator or worker changed the job first.

## Alert ownership

The on-call application operator owns API availability, error-rate, latency,
dead-letter, and backlog alerts. Start with the checked-in thresholds, then
adjust them from staging and production measurements. Record every threshold
change with the measured baseline that justified it.
