import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  RequestLoggingMiddleware,
  type RequestWithId,
} from "./request-logging.middleware.js";
import { HttpMetrics } from "./observability/http-metrics.js";

function createResponse() {
  const response = new EventEmitter() as EventEmitter & {
    setHeader: ReturnType<typeof vi.fn>;
    statusCode: number;
  };
  response.setHeader = vi.fn();
  response.statusCode = 200;
  return response;
}

describe("RequestLoggingMiddleware", () => {
  it("propagates a safe request ID and bounds metric paths by route", () => {
    const logger = {
      info: vi.fn(),
    };
    const metrics = new HttpMetrics();
    const middleware = new RequestLoggingMiddleware(logger as never, metrics);
    const request = {
      baseUrl: "",
      header: vi.fn((name: string) =>
        name === "x-request-id" ? "client-request-42" : undefined
      ),
      method: "GET",
      path: "/status",
      route: { path: "/status" },
    } as unknown as RequestWithId;
    const response = createResponse();
    const next = vi.fn();

    middleware.use(request, response as never, next);
    response.emit("finish");

    expect(request.requestId).toBe("client-request-42");
    expect(response.setHeader).toHaveBeenCalledWith(
      "x-request-id",
      "client-request-42"
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http.request.completed",
        path: "/status",
        request_id: "client-request-42",
        trace_id: expect.stringMatching(/^[0-9a-f]{32}$/),
      })
    );
    expect(metrics.render()).toContain('path="/status"');
    expect(next).toHaveBeenCalledOnce();
  });

  it("uses one metric label for unmatched paths", () => {
    const metrics = new HttpMetrics();
    const middleware = new RequestLoggingMiddleware(
      { info: vi.fn() } as never,
      metrics
    );
    const request = {
      baseUrl: "",
      header: vi.fn(),
      method: "GET",
      path: "/attacker-controlled-value",
    } as unknown as RequestWithId;
    const response = createResponse();

    response.statusCode = 404;
    middleware.use(request, response as never, vi.fn());
    response.emit("finish");

    expect(metrics.render()).toContain('path="/unmatched"');
    expect(metrics.render()).not.toContain("attacker-controlled-value");
  });

  it("replaces unsafe request IDs", () => {
    const middleware = new RequestLoggingMiddleware(
      {
        info: vi.fn(),
      } as never,
      new HttpMetrics()
    );
    const request = {
      baseUrl: "",
      header: vi.fn((name: string) =>
        name === "x-request-id" ? "unsafe\nrequest-id" : undefined
      ),
      method: "GET",
      path: "/status",
    } as unknown as RequestWithId;
    const response = createResponse();

    middleware.use(request, response as never, vi.fn());

    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
