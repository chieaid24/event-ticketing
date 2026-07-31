# Release Public-Read Load - 2026-07-31

The rate-limit-aware retest completed 392 requests with no failed request, a
46.27 ms p95 response time, and no invariant failure.

## Method

I ran k6 0.57.0 from the pinned container image
`grafana/k6@sha256:70af91f86cd8e142e0544a4edaf79835a80033f71974b92edd5ac36fd4442a7b`
against one local API development process. PostgreSQL 18.4 and Redis 8.8.1 ran
in Docker. The host exposed 22 logical CPUs and 15 GiB of memory under WSL2.

The deterministic dataset contained one published event, eight assigned seats,
and a general-admission capacity of 200. Each iteration sent one request to each
endpoint:

- `GET /health/live`
- `GET /discovery/events?limit=20`
- `GET /discovery/events/:eventId`
- `GET /discovery/events/:eventId/availability`

The retest used 2 virtual users for 30 seconds with a 600 ms pause per
iteration. Run it from Docker Desktop with:

```bash
docker run --rm \
  --env BASE_URL=http://host.docker.internal:4000 \
  --volume "$PWD/tests/load:/scripts:ro" \
  grafana/k6@sha256:70af91f86cd8e142e0544a4edaf79835a80033f71974b92edd5ac36fd4442a7b \
  run /scripts/release-verification.js
```

## Results

| Metric                |           Result |
| --------------------- | ---------------: |
| Duration              |             30 s |
| Virtual users         |                2 |
| Iterations            |               98 |
| Requests              |              392 |
| Request rate          | 11.64 requests/s |
| Failed requests       |            0.00% |
| Mean response time    |         21.10 ms |
| p90 response time     |         34.62 ms |
| p95 response time     |         46.27 ms |
| Maximum response time |        112.88 ms |
| Invariant failures    |                0 |

The run transferred 439 kB to the client. Every response returned `200` with a
JSON content type. The scenario's thresholds required less than 1% failed
requests, p95 below 500 ms, and zero invariant failures.

## Bottleneck and retest

An initial 20-virtual-user run crossed the public discovery controllers' per-IP
limits because Docker presented every virtual user through one source address.
The list and availability routes allow 120 requests per minute per IP, and the
detail route allows 240. The run returned `429` after those budgets were
exhausted, so it was not a valid capacity result.

I reduced the default scenario to 2 virtual users and added a 600 ms iteration
pause. The retest stayed within the request budgets and passed every threshold.
The result shows the local process behavior below the public abuse-control
ceiling; it does not justify raising that ceiling.

## Limits

This was a local, single-process, cleartext HTTP test. It excluded CloudFront,
WAF, TLS, network latency, ECS scaling, RDS, ElastiCache, authenticated holds,
checkout mutations, payment webhooks, and scanner bursts. It did not collect
CPU, memory, database lock-wait, or Redis latency time series. Run credentialed
mutation and provider scenarios in an owner-authorized private staging
environment, then report those signals before making a production capacity
claim.
