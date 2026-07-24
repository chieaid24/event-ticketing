import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  RequestLoggingMiddleware,
  type RequestWithId,
} from "./request-logging.middleware.js";

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
  it("propagates a safe request ID and logs the path without its query", () => {
    const logger = {
      info: vi.fn(),
    };
    const middleware = new RequestLoggingMiddleware(logger as never);
    const request = {
      header: vi.fn().mockReturnValue("client-request-42"),
      method: "GET",
      path: "/status",
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
      })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("replaces unsafe request IDs", () => {
    const middleware = new RequestLoggingMiddleware({
      info: vi.fn(),
    } as never);
    const request = {
      header: vi.fn().mockReturnValue("unsafe\nrequest-id"),
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
