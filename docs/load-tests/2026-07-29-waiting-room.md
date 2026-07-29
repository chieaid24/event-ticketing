# Waiting-Room Local Load Probe - 2026-07-29

The local Redis probe admitted exactly 25 of 500 queued sessions under a
25-lease cap and left 475 sessions queued.

## Environment

- Host: local WSL development machine
- Runtime: Node.js 22.22.3 and pnpm 11.17.0
- Redis: pinned Redis 8.8.1 Docker image from `compose.yaml`
- Network: loopback
- Dataset: one synthetic event and 500 synthetic session UUIDs
- Command: `pnpm --filter @event-ticketing/api test:waiting-room-load`

The repository targets Node.js 24. The local runner reported the version
mismatch, so these results describe only this controlled development run.

## Workload

The probe submitted 500 joins concurrently, repeated the first actor's join,
then polled admission concurrently for all 500 actors. Admission capacity was
25, heartbeat expiry was 60 seconds, and admission lease expiry was 300 seconds.
The test removed its event-scoped Redis keys afterward.

## Results

| Measurement                       | Result                   |
| --------------------------------- | ------------------------ |
| Final queue depth                 | 475                      |
| Admitted sessions                 | 25                       |
| Admission rate in test minute     | 25                       |
| Join batch duration               | 18.23 ms                 |
| Join throughput                   | 27,434.14/s              |
| Join latency p50 / p95 / p99      | 15.84 / 16.12 / 17.38 ms |
| Admission batch duration          | 13.18 ms                 |
| Admission latency p50 / p95 / p99 | 12.23 / 12.71 / 12.77 ms |
| Admitted wait p50 / p95 / p99     | 19 / 19 / 19 ms          |
| Duplicate queue entries           | 0                        |
| Admissions above lease cap        | 0                        |

The probe also verified that retrying the admitted hold with the same
idempotency key succeeds and presenting the same admission nonce with a
different key fails.

## Limits

This probe measures Redis coordination on one host. It does not include HTTP,
authentication, PostgreSQL hold latency, multiple API instances, a wide-area
network, CPU saturation, memory saturation, Redis failover, or production
traffic. Do not use these values as production capacity.
