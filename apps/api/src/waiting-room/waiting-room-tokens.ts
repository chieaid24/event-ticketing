import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type WaitingRoomTokenKind = "queue" | "admission";

export interface WaitingRoomTokenClaims {
  eventId: string;
  expiresAt: number;
  issuedAt: number;
  joinedAt: number;
  kind: WaitingRoomTokenKind;
  nonce: string;
  sessionId: string;
  version: 1;
}

export class InvalidWaitingRoomTokenError extends Error {
  constructor() {
    super("Invalid waiting-room token.");
    this.name = "InvalidWaitingRoomTokenError";
  }
}

function decodeClaims(value: string): WaitingRoomTokenClaims {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<WaitingRoomTokenClaims>;
    if (
      parsed.version !== 1 ||
      (parsed.kind !== "queue" && parsed.kind !== "admission") ||
      typeof parsed.eventId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.joinedAt !== "number"
    ) {
      throw new InvalidWaitingRoomTokenError();
    }
    return parsed as WaitingRoomTokenClaims;
  } catch {
    throw new InvalidWaitingRoomTokenError();
  }
}

export class WaitingRoomTokens {
  constructor(private readonly secret: string) {}

  issue(input: {
    eventId: string;
    expiresAt: number;
    joinedAt: number;
    kind: WaitingRoomTokenKind;
    now: number;
    nonce?: string;
    sessionId: string;
  }): string {
    const claims: WaitingRoomTokenClaims = {
      eventId: input.eventId,
      expiresAt: input.expiresAt,
      issuedAt: input.now,
      joinedAt: input.joinedAt,
      kind: input.kind,
      nonce: input.nonce ?? randomUUID(),
      sessionId: input.sessionId,
      version: 1,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  verify(
    token: string | undefined,
    expected: {
      eventId: string;
      kind: WaitingRoomTokenKind;
      now: number;
      sessionId: string;
    }
  ): WaitingRoomTokenClaims {
    if (!token || token.length > 1_024) {
      throw new InvalidWaitingRoomTokenError();
    }
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) {
      throw new InvalidWaitingRoomTokenError();
    }
    const supplied = Buffer.from(signature, "base64url");
    const calculated = Buffer.from(this.sign(payload), "base64url");
    if (
      Buffer.from(payload, "base64url").toString("base64url") !== payload ||
      supplied.toString("base64url") !== signature ||
      supplied.length !== calculated.length ||
      !timingSafeEqual(supplied, calculated)
    ) {
      throw new InvalidWaitingRoomTokenError();
    }
    const claims = decodeClaims(payload);
    if (
      claims.kind !== expected.kind ||
      claims.eventId !== expected.eventId ||
      claims.sessionId !== expected.sessionId ||
      claims.expiresAt <= expected.now ||
      claims.issuedAt > expected.now
    ) {
      throw new InvalidWaitingRoomTokenError();
    }
    return claims;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret)
      .update(payload)
      .digest("base64url");
  }
}
