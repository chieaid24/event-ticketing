# Security Model

SeatFlow accepts untrusted browser input, organizer content, webhook requests,
uploads, QR bearer values, and repository contributions.

## Trust boundaries

The API authenticates and authorizes every protected action. Hidden UI controls
are not authorization. Scope organizer data by organization and prevent
cross-tenant object access.

Use opaque random session tokens in Secure, HttpOnly, SameSite=Lax cookies.
Store only SHA-256 token hashes, rotate after privilege changes, enforce idle
and absolute expiry, and revoke all sessions after password reset. Require a
session-bound CSRF token and verify trusted origins for mutations.

Hash passwords with Argon2id. Store verification and reset tokens only as
single-use hashes with short expiry. Return generic account-lookup errors and
rate limit sensitive routes.

## External boundaries

- Verify Stripe signatures against the raw body and deduplicate provider event
  IDs.
- Use Stripe-hosted components so card data never crosses SeatFlow servers.
- Validate upload bytes, dimensions, MIME type, extension, and size. Re-encode
  allowed images and avoid unsanitized SVG.
- Use constrained presigned object keys and short expirations.
- Sign waiting-room tokens, bind them to event and session, limit replay, and
  enforce admission in the API.
- Use QR values with at least 256 bits of entropy and store only their hashes.

## API controls

Use HTTPS, explicit CORS, bounded request sizes, secure headers, restrictive
Content Security Policy, parameterized queries, output encoding, Markdown
sanitization, route-risk rate limits, safe errors, request IDs, timeouts,
bounded retries, least-privilege database roles, and least-privilege IAM.

Never log secrets, cookies, authorization headers, reset values, QR payloads,
full payment events, card data, or unnecessary personal information.

## Threats to test

Cover spoofed sessions and scanners, forged Stripe or queue tokens, price and
seat substitution, organization boundary bypass, role escalation, SQL injection,
stored XSS, request flooding, oversized upload, reset reuse, idempotency
conflicts, QR guessing, duplicate scans, and audit repudiation.

For each material threat, document the asset, actor, path, control, residual
risk, test, signal, and owner.

## Public disclosure

This repository is public. Never file exploit detail in an ordinary issue. Keep
security remediation titles and diffs focused on intended behavior. Use private
vulnerability reporting for sensitive findings. Rotate any credential that
enters Git history even if the commit is later rewritten.

See [SECURITY.md](../../SECURITY.md) for reporting and repository handling.
