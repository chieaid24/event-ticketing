import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import type { Logger } from "pino";

import type { RequestWithId } from "./request-logging.middleware.js";
import { FRONT_DOOR_PROFILE_ID, STRUCTURED_LOGGER } from "./runtime.tokens.js";

// Container Apps probes and the private-network metrics scrape reach the API
// without traversing Front Door, so they never carry X-Azure-FDID.
const exemptPathPattern = /^\/(?:health\/(?:live|ready)|metrics)$/;

@Injectable()
export class FrontDoorVerificationMiddleware implements NestMiddleware {
  private readonly expectedProfileId: string | null;

  constructor(
    @Inject(FRONT_DOOR_PROFILE_ID) expectedProfileId: string | null,
    @Inject(STRUCTURED_LOGGER) private readonly logger: Logger
  ) {
    // Front Door profile IDs are GUIDs, which compare case-insensitively.
    this.expectedProfileId = expectedProfileId?.trim().toLowerCase() ?? null;
  }

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    // request.path is rewritten to "/" inside mounted middleware; the
    // original URL keeps the real path.
    const path = request.originalUrl.split("?")[0] ?? "";
    if (this.expectedProfileId === null || exemptPathPattern.test(path)) {
      next();
      return;
    }

    const profileId = request.header("x-azure-fdid");
    if (profileId?.trim().toLowerCase() === this.expectedProfileId) {
      next();
      return;
    }

    // The header value is attacker-controlled; log only its presence.
    this.logger.warn({
      event: "http.request.rejected",
      header_present: profileId !== undefined,
      method: request.method,
      path,
      reason: "front_door_profile_mismatch",
      request_id: request.requestId,
    });
    response.status(403).json({ message: "Forbidden", statusCode: 403 });
  }
}
