import { HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { TicketsController } from "./tickets.controller.js";
import type { TicketsService } from "./tickets.service.js";

const ticketId = "77777777-7777-4777-8777-777777777777";

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

describe("TicketsController privacy headers", () => {
  it("seals every authenticated ticket response against caching and indexing", async () => {
    const service = {
      getTicket: vi.fn().mockResolvedValue({ id: ticketId }),
      listTickets: vi.fn().mockResolvedValue({ tickets: [] }),
      revealQr: vi.fn().mockResolvedValue({ token: "x" }),
    } as unknown as TicketsService;
    const controller = new TicketsController(service, allowLimiter);

    for (const call of [
      (response: Response) => controller.listTickets(fakeRequest(), response),
      (response: Response) =>
        controller.getTicket(fakeRequest(), response, ticketId),
      (response: Response) =>
        controller.revealQr(fakeRequest(), response, ticketId),
    ]) {
      const { response, headers } = fakeResponse();
      await call(response);
      expect(headers.get("Cache-Control")).toBe("no-store, private");
      expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    }
  });

  it("rejects with 429 when the rate limit is exceeded", async () => {
    const service = {
      listTickets: vi.fn(),
    } as unknown as TicketsService;
    const controller = new TicketsController(service, denyLimiter);
    const { response } = fakeResponse();

    const error = await controller
      .listTickets(fakeRequest(), response)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(service.listTickets).not.toHaveBeenCalled();
  });
});
