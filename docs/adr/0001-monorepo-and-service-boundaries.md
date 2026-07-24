# ADR 0001: Monorepo and Service Boundaries

## Status

Accepted

## Context

The platform needs one typed contract across customer interfaces, trusted API
decisions, and retryable background work. These applications deploy and scale
independently, but separate repositories would make contract changes and
cross-application verification harder to keep atomic.

The issue queue also requires every merged slice to leave the system runnable. A
shared build graph can verify affected applications and packages before one
change merges.

## Decision

Use a pnpm workspace and Turborepo build graph. Keep deployable applications in
`apps/web`, `apps/api`, and `apps/worker`. Keep reusable boundaries in
`packages/contracts`, `packages/database`, `packages/config`, `packages/ui`, and
`packages/test-utils`.

The web application renders interfaces and consumes public contracts. The API
owns trusted domain decisions. The worker executes retryable asynchronous work.
Shared packages cannot reverse these dependencies or import an application.

Use strict TypeScript throughout the workspace. Build shared packages before
applications so deployable output consumes explicit package exports.

## Alternatives

A single deployable application would reduce the initial process count, but it
would couple request latency, frontend rendering, and background job capacity.

Separate repositories would isolate deployments, but they would require a
published package workflow before a contract change could be verified across all
consumers.

An unstructured monorepo without package boundaries would keep one checkout but
would not prevent application code from bypassing the intended trust boundary.

## Consequences

One pull request can change a contract and every consumer. Turborepo can cache
and order workspace tasks. Each application keeps an independent runtime entry
point and can gain its own deployment configuration.

The repository must maintain package exports, dependency direction, local
READMEs, and task configuration. Shared package changes can trigger more builds
than an isolated repository would.

## Security impact

The API remains the only application that makes trusted authorization,
inventory, payment, and ticket decisions. The web cannot import database or
provider implementations. Shared contracts validate public data without exposing
database records.

## Operational impact

`pnpm dev` starts all three applications. CI runs formatting, lint, strict type
checks, unit tests, builds, and secret scanning in one required job. Deployment
slices can package and scale each application independently without changing the
source layout.
