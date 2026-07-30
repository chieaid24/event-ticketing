import { HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { ScanningController } from "./scanning.controller.js";
import type { ScanningService } from "./scanning.service.js";

const organizationId = "22222222-2222-4222-8222-222222222222";
const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function fakeRequest(): Request {
  return {
    header: () => undefined,
    headers: {},
    ip: "127.0.0.1",
  } as unknown as Request;
}

function fakeResponse(): { response: Response; headers: Map<string, string> } {
  const headers = new Map<string, string>();
  const response = {
    setHeader: (name: string, value: string) => headers.set(name, value),
  } as unknown as Response;
  return { response, headers };
}

const allowLimiter: RateLimiter = {
  consume: vi.fn().mockResolvedValue(true),
};

const denyLimiter: RateLimiter = {
  consume: vi.fn().mockResolvedValue(false),
};

describe("ScanningController", () => {
  it("seals every scanner response against caching and indexing", async () => {
    const service = {
      activity: vi.fn().mockResolvedValue({ canReverse: false, scans: [] }),
      checkIn: vi.fn().mockResolvedValue({ result: "invalid", ticket: null }),
      reverse: vi.fn().mockResolvedValue({ ticket: {} }),
    } as unknown as ScanningService;
    const controller = new ScanningController(service, allowLimiter);

    for (const call of [
      (response: Response) =>
        controller.checkIn(
          fakeRequest(),
          response,
          organizationId,
          eventId,
          {}
        ),
      (response: Response) =>
        controller.reverse(
          fakeRequest(),
          response,
          organizationId,
          eventId,
          {}
        ),
      (response: Response) =>
        controller.activity(fakeRequest(), response, organizationId, eventId),
    ]) {
      const { response, headers } = fakeResponse();
      await call(response);
      expect(headers.get("Cache-Control")).toBe("no-store, private");
      expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("rejects with 429 before reaching the service when the address limit is exceeded", async () => {
    const service = { checkIn: vi.fn() } as unknown as ScanningService;
    const controller = new ScanningController(service, denyLimiter);
    const { response } = fakeResponse();

    const error = await controller
      .checkIn(fakeRequest(), response, organizationId, eventId, {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(service.checkIn).not.toHaveBeenCalled();
  });
});
