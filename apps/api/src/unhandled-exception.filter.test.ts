import { HttpException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { UnhandledExceptionFilter } from "./unhandled-exception.filter.js";

function buildHost() {
  const response = {
    json: vi.fn(),
    status: vi.fn(),
  };
  response.status.mockReturnValue(response);
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe("UnhandledExceptionFilter", () => {
  it("logs unexpected errors and answers with an anonymous 500", () => {
    const logger = { error: vi.fn() } as unknown as Logger;
    const { host, response } = buildHost();

    new UnhandledExceptionFilter(logger).catch(
      new Error("connection pool exhausted"),
      host
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: "connection pool exhausted" }),
        event: "http.request.unhandled_error",
      })
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      message: "Internal server error",
      statusCode: 500,
    });
  });

  it("passes http-errors with their own status through without logging", () => {
    const logger = { error: vi.fn() } as unknown as Logger;
    const { host, response } = buildHost();
    const payloadTooLarge = Object.assign(
      new Error("request entity too large"),
      { statusCode: 413 }
    );

    new UnhandledExceptionFilter(logger).catch(payloadTooLarge, host);

    expect(logger.error).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(413);
    expect(response.json).toHaveBeenCalledWith({
      message: "request entity too large",
      statusCode: 413,
    });
  });

  it("passes HttpException responses through without logging", () => {
    const logger = { error: vi.fn() } as unknown as Logger;
    const { host, response } = buildHost();

    new UnhandledExceptionFilter(logger).catch(
      new HttpException({ code: "rate_limited" }, 429),
      host
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({ code: "rate_limited" });
  });
});
