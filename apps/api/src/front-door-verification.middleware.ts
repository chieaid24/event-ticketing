import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import type { Logger } from "pino";

import type { RequestWithId } from "./request-logging.middleware.js";
import { FRONT_DOOR_PROFILE_ID, STRUCTURED_LOGGER } from "./runtime.tokens.js";

// internal probes bypass front door
const exemptPathPattern = /^\/(?:health\/(?:live|ready)|metrics)$/;

@Injectable()
export class FrontDoorVerificationMiddleware implements NestMiddleware {
  private readonly expectedProfileId: string | null;

  constructor(
    @Inject(FRONT_DOOR_PROFILE_ID) expectedProfileId: string | null,
    @Inject(STRUCTURED_LOGGER) private readonly logger: Logger
  ) {
    // compare profile ids case-insensitively
    this.expectedProfileId = expectedProfileId?.trim().toLowerCase() ?? null;
  }

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    // mounted middleware rewrites paths; original url stays intact
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

    // header value attacker-controlled; log only presence
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
