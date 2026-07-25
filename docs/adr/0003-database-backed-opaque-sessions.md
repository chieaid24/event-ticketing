# 0003 Database-Backed Opaque Sessions

## Status

Accepted

## Context

Issue #6 delivers registration, verification, login, password lifecycle, and
session management. The platform needs a session mechanism that supports instant
revocation (password reset must sign out every device), a session list per user,
idle plus absolute expiry, and CSRF protection for cookie authenticated
mutations. The browser must never decide identity or session state.

## Decision

Sessions are opaque random secrets stored in an HttpOnly, SameSite=Lax cookie
(`et_session`). The database stores only the SHA-256 hash of the secret in
`sessions.token_hash`, together with idle (`last_seen_at`) and absolute
(`absolute_expires_at`) expiry inputs and a `revoked_at` marker. PostgreSQL is
the single authority on whether a session is live.

Every session carries a second secret in a JavaScript-readable cookie
(`et_csrf`). Mutating cookie-authenticated routes require the `x-csrf-token`
header to hash-match the session row (double submit bound to the session) and
reject untrusted `Origin` headers. Login mints a fresh session, and a password
change revokes every session and rotates the caller onto a new one.

Email verification and password reset use the same pattern: single-use, expiring
`auth_tokens` rows that hold only SHA-256 hashes. The worker mints these tokens
when it sends the email, so plaintext secrets never pass through outbox payloads
or logs.

## Alternatives

- Stateless JWT sessions: no per-request database read, but revocation requires
  a denylist that reintroduces the database read while adding key management and
  token size costs. Rejected because instant revocation is a hard requirement.
- Server-side session store in Redis: fast, but sessions become less durable
  than the orders they authorize, and PostgreSQL already sits on the hot path.
  Rejected to keep one authoritative store.
- SameSite=Strict cookies without a CSRF token: breaks top-level navigation from
  emails and still leaves same-site subdomain risk. Rejected in favor of Lax
  plus a session-bound double-submit token and origin checks.

## Consequences

- Session validation costs one indexed lookup plus a `last_seen_at` update per
  authenticated request. Acceptable at current scale; a cache can be added
  behind the same interface later.
- Revocation, reset, and rotation are single UPDATE statements with immediate
  effect everywhere.
- The frontend reads the CSRF cookie and echoes it as a header; API clients that
  skip cookies are unaffected.

## Security impact

- A database leak exposes only hashes; cookies never reach JavaScript.
- Session fixation is prevented because secrets are minted server-side at login
  and rotated on password change.
- CSRF requires both a forged request and knowledge of the per-session secret,
  and untrusted origins are rejected outright.

## Operational impact

- Expired and revoked rows accumulate in `sessions` and `auth_tokens`; a
  periodic cleanup job can prune them without correctness impact.
- `SESSION_IDLE_TTL_SECONDS` and `SESSION_ABSOLUTE_TTL_SECONDS` tune expiry
  without code changes; `API_TRUSTED_ORIGINS` must list every deployed web
  origin.
