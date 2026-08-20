# Load Tests

Run the scenarios from a controlled environment and commit measured reports next
to the scripts they describe.

Available reports:

- [Waiting-room load](2026-07-29-waiting-room.md)
- [Release public-read load](2026-07-31-release-verification.md)
- [Purchase-flow load](2026-08-20-purchase-flow.md)

Purchase-flow scenario assets:
[`tests/load/purchase-flow.js`](../../tests/load/purchase-flow.js) drives login,
holds, checkout, simulated payment, and ticket issuance;
[`tests/load/verify-purchase-invariants.mjs`](../../tests/load/verify-purchase-invariants.mjs)
verifies inventory, payment, and expiry invariants against PostgreSQL after a
run. Seed the dataset with `pnpm db:seed:load` first.

Store k6 scenarios, environment descriptions, and dated measured reports here.
Keep raw customer data and credentials out of this public repository.

Follow [the testing strategy](../testing/strategy.md). Report zero values for
double bookings and oversells explicitly, and do not turn controlled-test
results into production claims.
