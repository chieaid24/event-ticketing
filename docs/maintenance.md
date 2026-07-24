# Documentation and Codebase Maintenance

Keep the repository navigable as part of every change.

The repository and its full history are public. Documentation must use safe
placeholders and synthetic examples. Never add credentials, customer data,
private endpoints, or undisclosed incident details.

## Source-of-truth order

1. `VISION.md` sets project direction and non-negotiable priorities.
2. `CONTEXT.md` defines domain terms.
3. Topic documents under `docs/` define product and engineering behavior.
4. ADRs explain hard-to-reverse decisions.
5. The nearest code-area `README.md` explains current implementation.
6. Generated OpenAPI and database artifacts describe executable interfaces.

When sources disagree, do not silently choose one. Correct the stale source in
the same pull request or record the unresolved conflict in the issue.

## Required navigation

Add every new durable document to `docs/README.md`. Add every new top-level code
area to the ownership map. Give each implemented application or package a local
`README.md` with:

- its responsibility and explicit non-responsibilities;
- public entry points;
- dependencies and consumers;
- relevant configuration;
- test commands; and
- links to owning specifications and ADRs.

Keep local READMEs short. Put shared rules in one topic document and link to it.

## Update triggers

Update documentation in the same change when you:

- add or rename an application, package, route group, queue, or infrastructure
  module;
- change a state transition, invariant, authorization rule, or error code;
- add a migration or alter retention, backup, recovery, or deployment behavior;
- change a test command, development prerequisite, or CI gate;
- introduce a metric, alert, operational dependency, or runbook procedure; or
- make a decision that is expensive to reverse.

## ADR threshold

Create an ADR only when a decision is hard to reverse, surprising without
context, and based on a real trade-off. Update architecture docs for ordinary
design evolution.

## Mechanical checks

Run:

```bash
npx --yes pnpm@11.17.0 format:check
npx --yes pnpm@11.17.0 test
```

Repository tests reject broken relative links, missing navigation documents, and
discarded project names. Extend the tests when a new invariant can be checked
mechanically.
