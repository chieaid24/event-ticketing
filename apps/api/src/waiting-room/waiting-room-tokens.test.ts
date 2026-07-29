import { describe, expect, it } from "vitest";

import {
  InvalidWaitingRoomTokenError,
  WaitingRoomTokens,
} from "./waiting-room-tokens.js";

const eventId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const now = 1_785_300_000_000;

function issue(): { service: WaitingRoomTokens; token: string } {
  const service = new WaitingRoomTokens("a-test-secret-with-at-least-32-bytes");
  return {
    service,
    token: service.issue({
      eventId,
      expiresAt: now + 60_000,
      joinedAt: now - 1_000,
      kind: "admission",
      now,
      sessionId,
    }),
  };
}

describe("WaitingRoomTokens", () => {
  it("round-trips signed claims", () => {
    const { service, token } = issue();
    expect(
      service.verify(token, {
        eventId,
        kind: "admission",
        now,
        sessionId,
      })
    ).toMatchObject({ eventId, kind: "admission", sessionId });
  });

  it("rejects altered tokens", () => {
    const { service, token } = issue();
    expect(() =>
      service.verify(`${token.slice(0, -1)}x`, {
        eventId,
        kind: "admission",
        now,
        sessionId,
      })
    ).toThrow(InvalidWaitingRoomTokenError);
  });

  it.each([
    {
      eventId: "33333333-3333-4333-8333-333333333333",
      kind: "admission" as const,
      now,
      sessionId,
    },
    {
      eventId,
      kind: "admission" as const,
      now,
      sessionId: "44444444-4444-4444-8444-444444444444",
    },
    {
      eventId,
      kind: "admission" as const,
      now: now + 60_001,
      sessionId,
    },
    {
      eventId,
      kind: "queue" as const,
      now,
      sessionId,
    },
  ])("rejects mismatched or expired claims", (expected) => {
    const { service, token } = issue();
    expect(() => service.verify(token, expected)).toThrow(
      InvalidWaitingRoomTokenError
    );
  });
});
