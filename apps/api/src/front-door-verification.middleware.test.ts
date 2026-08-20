import { describe, expect, it, vi } from "vitest";

import { FrontDoorVerificationMiddleware } from "./front-door-verification.middleware.js";
import type { RequestWithId } from "./request-logging.middleware.js";

const profileId = "11111111-2222-3333-4444-555555555555";

function createRequest(headers: Record<string, string>, path = "/status") {
  return {
    header: vi.fn((name: string) => headers[name.toLowerCase()]),
    method: "GET",
    // Express rewrites request.path inside mounted middleware; the
    // middleware reads originalUrl instead.
    originalUrl: path,
    requestId: "request-1",
  } as unknown as RequestWithId;
}

function createResponse() {
  const response = {
    json: vi.fn(),
    status: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

function createMiddleware(expectedProfileId: string | null) {
  const logger = { warn: vi.fn() };
  return {
    logger,
    middleware: new FrontDoorVerificationMiddleware(
      expectedProfileId,
      logger as never
    ),
  };
}

describe("FrontDoorVerificationMiddleware", () => {
  it("accepts requests from the configured Front Door profile", () => {
    const { middleware } = createMiddleware(profileId);
    const response = createResponse();
    const next = vi.fn();

    middleware.use(
      createRequest({ "x-azure-fdid": profileId }),
      response as never,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("compares profile IDs case-insensitively", () => {
    const { middleware } = createMiddleware(profileId.toUpperCase());
    const next = vi.fn();

    middleware.use(
      createRequest({ "x-azure-fdid": profileId }),
      createResponse() as never,
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects requests without the header and logs only its presence", () => {
    const { logger, middleware } = createMiddleware(profileId);
    const response = createResponse();
    const next = vi.fn();

    middleware.use(createRequest({}), response as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      message: "Forbidden",
      statusCode: 403,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http.request.rejected",
        header_present: false,
        reason: "front_door_profile_mismatch",
        request_id: "request-1",
      })
    );
  });

  it("rejects requests from another Front Door profile", () => {
    const { logger, middleware } = createMiddleware(profileId);
    const response = createResponse();
    const next = vi.fn();

    middleware.use(
      createRequest({
        "x-azure-fdid": "99999999-8888-7777-6666-555555555555",
      }),
      response as never,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ header_present: true })
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        header_present: expect.stringContaining("9999"),
      })
    );
  });

  it("passes every request through when verification is disabled", () => {
    const { middleware } = createMiddleware(null);
    const response = createResponse();
    const next = vi.fn();

    middleware.use(createRequest({}), response as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("exempts probe and metrics paths that bypass Front Door", () => {
    const { middleware } = createMiddleware(profileId);

    for (const path of [
      "/health/live",
      "/health/ready",
      "/health/ready?deep=1",
      "/metrics",
    ]) {
      const next = vi.fn();
      middleware.use(createRequest({}, path), createResponse() as never, next);
      expect(next).toHaveBeenCalledOnce();
    }

    const next = vi.fn();
    const response = createResponse();
    middleware.use(createRequest({}, "/health/other"), response as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });
});
