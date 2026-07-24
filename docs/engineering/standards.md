# Engineering Standards

## Code

- Use TypeScript strict mode without implicit `any`.
- Prefer discriminated unions and exhaustive switches for state.
- Keep controllers thin and business rules in domain services.
- Use dependency injection and isolate provider clients behind interfaces.
- Keep raw SQL in inventory repositories and use parameterized values.
- Define transaction boundaries explicitly and keep them short.
- Do not call Stripe, email, or object storage while holding inventory locks.
- Use UTC storage, database time for expiry, integer minor units for money, and
  stable error codes.
- Keep comments to the shortest wording that explains why.
- Delete dead code and do not suppress quality rules to bypass failures.

## Validation

Validate frontend interaction, backend requests, domain rules, and database
constraints independently. Reject unknown mutation fields, malformed IDs,
ambiguous coercions, unsafe numbers, excessive arrays, oversized bodies, and
unapproved enums.

Share explicit Zod contracts between frontend and API. Do not expose database
entities as public contracts.

## Pull requests

Describe the problem, behavior, migrations, API or schema changes, security
impact, tests, manual evidence, observability, and rollback. Include screenshots
for UI changes.

Do not merge when tests or type checking fail, migrations are unsafe,
authorization or backend validation is missing, retry behavior is undefined,
sensitive data appears in output, or inventory correctness depends on Redis.

## Completion

A feature includes functional behavior, validation, authorization, database
protection where needed, safe errors, logs and metrics, relevant tests,
documentation, accessibility review, and a runnable demonstration.

Before declaring a phase complete, report changed files, migrations, routes,
security controls, tests, commands, observed results, limitations, next work,
and ADRs.

## Public repository

Assume every branch, commit, issue, pull request, log, and artifact is public.
Use synthetic fixtures and safe examples. Never include credentials or nonpublic
incident details. Follow [SECURITY.md](../../SECURITY.md).
