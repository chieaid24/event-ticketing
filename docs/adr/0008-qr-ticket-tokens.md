# ADR 0008: QR ticket tokens

## Status

Accepted

## Context

Every paid unit becomes one admission ticket. A ticket needs two identifiers
with opposite requirements. A customer, an organizer, and support all quote a
ticket in the clear, so it needs a short nonsecret number. A gate scanner proves
admission from a value a stranger must not be able to guess or reuse, so it
needs a high-entropy secret.

The security model requires QR values with at least 256 bits of entropy, stored
only as hashes, and forbids raw QR payloads from entering logs. The domain model
requires one ticket per purchased unit, a stored public number and QR token
hash, and never the raw token after issuance. Issuance runs asynchronously in
the worker after payment finalization, where there is no authenticated channel
to hand a secret back to the buyer, and email is too weak a channel for a bearer
credential.

## Decision

Each ticket carries a nonsecret `public_number` and the SHA-256 hash of its
current QR bearer in `qr_token_hash`. The raw bearer is never stored.

Issuance mints the public number and an unmatchable placeholder hash whose
preimage is discarded random data. No usable bearer exists yet, so nothing
secret leaves the asynchronous issuance path, a notification, or a log.

The owner materializes a usable bearer by an authenticated, CSRF-guarded reveal.
The reveal generates a fresh 256-bit bearer, stores its SHA-256 hash, stamps
`qr_rotated_at`, and returns the raw bearer exactly once in that response. Every
reveal rotates: writing the new hash atomically invalidates whatever bearer came
before, so a leaked screenshot cannot be reused after the next reveal. The
public number is immutable and never changes on rotation.

The bearer is an opaque `randomBytes(32)` base64url value, reusing the session
secret primitives (`generateAuthSecret`, SHA-256 hashing). It encodes no
personal data. Reveal responses set `Cache-Control: no-store, private` and
`X-Robots-Tag: noindex, nofollow`, and the web client renders the QR entirely in
the browser so the raw value never reaches server-rendered HTML.

## Alternatives

- **Mint the real bearer at issuance and deliver it.** Rejected: issuance is
  asynchronous with no authenticated channel, and delivering a bearer by email
  would put a reusable secret in a weak channel and in mail logs.
- **Signed stateless token (HMAC/JWT in the QR).** Rejected: it stores signing
  keys rather than per-ticket hashes, and revoking or rotating a single ticket
  then needs a separate deny list or version column. Per-ticket hash rotation
  invalidates one bearer with one row write.
- **Persist the raw bearer so the same QR can be shown repeatedly.** Rejected:
  it violates the store-only-hashes rule and makes a database read a credential
  disclosure. Rotate-on-reveal keeps only hashes and gives a dynamic QR for
  free.

## Consequences

- A ticket read never exposes a redeemable value; only a reveal does, and only
  to the authenticated owner.
- Redemption compares the SHA-256 hash of a presented bearer against
  `qr_token_hash`, which is unique, so a match is one indexed lookup.
- A bearer is single-generation: revealing again replaces it. The UI states this
  so a customer is not surprised that an old screenshot stops scanning.
- Backfilled pre-credential tickets hold placeholder hashes and become usable on
  their owner's first reveal, with no data migration of secrets.

## Security impact

Raw bearers exist only in memory and in one authenticated HTTPS response; they
are never persisted or logged. Entropy is 256 bits, well beyond guessing.
Rotation gives per-ticket revocation. Public numbers are safe to display and
carry no personal data. Authenticated ticket responses are marked no-store and
noindex so a shared proxy or crawler never retains them.

## Operational impact

No new services or tables: three columns on `tickets` and one reveal endpoint.
The unique index on `qr_token_hash` turns a collision into a write error rather
than a silent duplicate. Rotation is a single indexed update, so reveal traffic
scales with the ticket table's existing indexes.
