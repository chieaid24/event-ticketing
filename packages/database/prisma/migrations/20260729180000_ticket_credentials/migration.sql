-- Ticket credentials: a nonsecret public number plus the SHA-256 hex hash of a
-- 256-bit QR bearer token. Only hashes are ever stored; the raw bearer is
-- minted at authenticated view time and returned once (see ADR 0008).
ALTER TABLE "tickets"
  ADD COLUMN "public_number" VARCHAR(20),
  ADD COLUMN "qr_token_hash" CHAR(64),
  ADD COLUMN "qr_rotated_at" TIMESTAMPTZ(6);

-- Backfill any pre-credential rows with unmatchable placeholder credentials:
-- the hash preimage is discarded random data, so no presented value can match
-- until the owner's first QR view rotates the credential.
UPDATE "tickets"
SET
  "public_number" = 'TK-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  "qr_token_hash" = encode(
    sha256(convert_to(
      gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8'
    )), 'hex')
WHERE "public_number" IS NULL;

ALTER TABLE "tickets"
  ALTER COLUMN "public_number" SET NOT NULL,
  ALTER COLUMN "qr_token_hash" SET NOT NULL;

CREATE UNIQUE INDEX "tickets_public_number_key" ON "tickets"("public_number");
CREATE UNIQUE INDEX "tickets_qr_token_hash_key" ON "tickets"("qr_token_hash");
