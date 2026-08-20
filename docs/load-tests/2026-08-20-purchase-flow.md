# Purchase-Flow Load - 2026-08-20

The floor run completed 1,117 end-to-end purchases with 50 concurrent virtual
buyers in 97.6 seconds with zero failed requests, zero invariant violations, and
hold/checkout p95 latencies under 120 ms. Stretch runs at 100 and 200 virtual
buyers completed 2,600 and 5,200 further purchases; the first threshold to break
was the assigned-seat hold p95 at 200 buyers, and the first systemic ceiling is
the worker's sequential payment finalization at roughly 10 purchases per second.

## Method

I ran k6 0.57.0 from the pinned container image
`grafana/k6@sha256:70af91f86cd8e142e0544a4edaf79835a80033f71974b92edd5ac36fd4442a7b`
against one built API process (`node dist/main.js`, Node.js 24.18.0) and one
built worker process on the same host. PostgreSQL 18.4 and Redis 8.8.1 ran in
Docker from the pinned `compose.yaml` images. The host exposed 22 logical CPUs
and 15 GiB of memory under WSL2. These are controlled local measurements on
developer hardware, not production capacity claims.

Environment overrides, all local-development-only:

- API: `API_PORT=4100`, `API_RATE_LIMITS_DISABLED=true` (the load-test
  rate-limit bypass; configuration refuses it under `NODE_ENV=production`),
  default `PAYMENT_PROVIDER=fake`.
- Worker: `WORKER_OUTBOX_BATCH_SIZE=100`, `WORKER_OUTBOX_POLL_INTERVAL_MS=50` so
  the outbox drains faster than purchases arrive.
- Dataset: `pnpm db:seed:load` - 250 active buyers, one published event with a
  general-admission capacity of 60,000, a 100-seat assigned block as the
  contention pool, and a 180-second hold TTL.

Payment finalization used the fake provider's `POST /payments/simulate` surface,
which builds a signed provider event from the stored order and pushes it through
the production webhook ingest path (signature verification, durable receipt,
deduplication, asynchronous worker finalization). The real Stripe integration is
untouched, and production configuration now refuses the fake provider outright,
with tests asserting the refusal.

Each iteration of `tests/load/purchase-flow.js` drives one buyer journey:
availability read, general-admission hold (quantity 1-2), idempotent checkout,
simulated payment, poll to `paid`, and ticket-issuance assertion. Every fifth
iteration additionally races for one assigned seat; every tenth replays the hold
and the checkout with identical idempotency input and takes a decline-then-retry
payment path; every twentieth abandons an extra hold so the expiry sweep can be
verified afterward. Expected contention (`409 seats_unavailable` /
`capacity_unavailable`) is counted separately from failures.

Floor-run invocation (stretch runs changed only `VUS`, `ITERATIONS`, and
`TARGET_PURCHASES`):

```bash
docker run --rm --add-host=host.docker.internal:host-gateway \
  --env BASE_URL=http://host.docker.internal:4100 \
  --env VUS=50 --env ITERATIONS=1100 --env TARGET_PURCHASES=1000 \
  --volume "$PWD/tests/load:/scripts:ro" \
  grafana/k6@sha256:70af91f86cd8e142e0544a4edaf79835a80033f71974b92edd5ac36fd4442a7b \
  run /scripts/purchase-flow.js
node tests/load/verify-purchase-invariants.mjs
```

## Results

| Metric                        |  Floor 50 VU | Stretch 100 VU | Stretch 200 VU |
| ----------------------------- | -----------: | -------------: | -------------: |
| Iterations                    |        1,100 |          2,600 |          5,200 |
| Completed purchases           |        1,117 |          2,600 |          5,200 |
| Purchase rate                 |      10.21/s |        10.37/s |         9.70/s |
| Duration                      |       97.6 s |        250.8 s |        488.3 s |
| HTTP requests                 |       17,394 |         67,215 |        254,832 |
| Unexpected failed requests    |        0.00% |          0.00% |          0.00% |
| Checks passed                 | 100% (6,101) |  100% (14,100) |  100% (28,200) |
| GA hold p95                   |     94.34 ms |      107.36 ms |      111.57 ms |
| Assigned hold p95             |    110.68 ms |      260.38 ms |  **511.27 ms** |
| Checkout p95                  |     62.26 ms |       75.75 ms |      108.38 ms |
| Finalization wait median      |       4.21 s |         8.79 s |        20.55 s |
| Finalization wait p95         |       7.92 s |        12.65 s |        24.48 s |
| Seat-race conflicts (409)     |          233 |            592 |          1,191 |
| Hold + checkout replays       |    150 + 150 |      260 + 260 |      520 + 520 |
| Simulated declines then retry |          150 |            260 |            520 |
| Abandoned holds               |           50 |            100 |            260 |

The floor run met every acceptance threshold: at least 50 concurrent purchasers,
at least 1,000 completed transactions, hold and checkout p95 under 500 ms,
unexpected failure rate under 1%, and zero client-observable idempotency
violations (every replayed hold returned its original hold id and every replayed
checkout returned its original order id). The 100-VU stretch also passed every
threshold. At 200 VUs the assigned-seat hold p95 crossed the 500 ms threshold
(511 ms) - the first threshold to break - while every other threshold still
passed and all 5,200 purchases completed.

## Invariants

`tests/load/verify-purchase-invariants.mjs` reads PostgreSQL directly as the
source of truth. After the floor run and again after both stretch runs
(cumulative state: 9,300 paid orders, 13,864 issued tickets):

| Invariant                                              | Violations |
| ------------------------------------------------------ | ---------: |
| Oversells by counters (reserved + sold > capacity)     |      **0** |
| Oversells by row recount (tickets + live hold lines)   |      **0** |
| Double-booked seats (>1 live ticket per seat)          |      **0** |
| Sold seats without exactly one live ticket             |      **0** |
| Paid orders lacking one succeeded payment at the total |      **0** |
| Expired holds still reserving inventory                |      **0** |
| Seats held by dead holds                               |      **0** |
| GA reserved-counter drift versus live hold lines       |      **0** |

The 50 holds abandoned during the floor run were swept by the worker's 60-second
expiry reconciliation after their 180-second TTL, returning the
general-admission reserved counter to zero.

## Bottlenecks

### Fixed during this test: synchronous daily analytics projection

The first 50-VU attempt collapsed: 850 of 1,100 general-admission holds and 46%
of checkouts failed with anonymous 500s, hold p95 reached 19 seconds, and
`pg_stat_activity` showed 10-20 backends queued on `Lock/transactionid` with
hold inserts waiting on an exclusive tuple lock on `analytics_daily_activity`.
Every hold insert and checkout-start fired a trigger chain that upserted one
(organization, day) analytics row inside the purchase transaction, so that
single hot row serialized every concurrent purchase; the resulting convoy
exhausted the 10-connection store pools, and each pool's 5-second connection
timeout surfaced as a bare 500. Migration
`20260820000000_defer_daily_analytics_projection` recreates the projection
trigger as `DEFERRABLE INITIALLY DEFERRED`, so the hot-row upsert runs at commit
and holds its lock for the commit only, keeping the projection transactional.
The identical 50-VU probe went from 78% to 100% iteration success and from 19 s
to 108 ms hold p95. The anonymous 500s also exposed that unhandled exceptions
were logged nowhere (`logger: false` disables the Nest fallback); a global
exception filter now records them.

### Remaining first ceiling: sequential payment finalization

Completed-purchase throughput plateaus near 10/s at 50, 100, and 200 VUs while
API latencies stay low - the asynchronous finalization pipeline, not the HTTP
path, is the ceiling. The single worker finalizes orders one at a time; during
the 200-VU run the `payment.intent.succeeded` outbox backlog held steady at
150-195 pending events, which at a 10/s service rate is exactly the observed
17-24 second finalization wait. Buyers see their order `pending_payment` for
that long before tickets issue. The second signal at 200 VUs is the
assigned-seat hold p95 crossing 500 ms once the 100-seat pool is sold out and
every race re-queues on the same seat rows. Scaling finalization (concurrent
worker lanes keyed to disjoint orders, or multiple worker processes) is the
natural next slice if these local numbers justify it.

## Limits

This was a local, single-process, cleartext HTTP test against the fake payment
provider with per-IP rate limits disabled. It excluded Front Door, WAF, TLS,
network latency, Container Apps scaling, PostgreSQL Flexible Server, Managed
Redis, the waiting room (disabled for the load event), real Stripe latency, and
scanner traffic. CPU, memory, and Redis latency time series were not collected.
A staging (Azure) run needs spend approval and stays out of scope; do not
present these results as production capacity.
