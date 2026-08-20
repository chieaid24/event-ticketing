import { createHmac, timingSafeEqual } from "node:crypto";

// shared stripe verification keeps fake delivery on the real path

export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface SignatureVerification {
  reason?: "malformed_header" | "signature_mismatch" | "timestamp_out_of_range";
  valid: boolean;
}

export function buildWebhookSignatureHeader(input: {
  payload: string;
  secret: string;
  timestampSeconds?: number;
}): string {
  const timestamp = input.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export function verifyWebhookSignatureHeader(input: {
  header: string;
  nowSeconds?: number;
  payload: string;
  secret: string;
  toleranceSeconds?: number;
}): SignatureVerification {
  const parts = input.header.split(",");
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key?.trim() === "t" && value !== undefined) {
      timestamp = Number.parseInt(value, 10);
    }
    if (key?.trim() === "v1" && value !== undefined) {
      candidates.push(value);
    }
  }

  if (
    timestamp === undefined ||
    Number.isNaN(timestamp) ||
    candidates.length === 0
  ) {
    return { reason: "malformed_header", valid: false };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance =
    input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) {
    return { reason: "timestamp_out_of_range", valid: false };
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest();
  for (const candidate of candidates) {
    let candidateBytes: Buffer;
    try {
      candidateBytes = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (
      candidateBytes.length === expected.length &&
      timingSafeEqual(candidateBytes, expected)
    ) {
      return { valid: true };
    }
  }
  return { reason: "signature_mismatch", valid: false };
}
