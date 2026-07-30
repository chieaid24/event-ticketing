# Local Infrastructure

`compose.yaml` runs PostgreSQL, Redis, Mailpit, and MinIO for local development
and integration tests. It does not define production infrastructure.

## Start and stop

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

See the [runbook index](../docs/operations/runbook-index.md) and
[security policy](../SECURITY.md).
