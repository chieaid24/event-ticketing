import { randomUUID } from "node:crypto";

import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

import { STRUCTURED_LOGGER } from "./runtime.tokens.js";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export interface RequestWithId extends Request {
  requestId: string;
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(@Inject(STRUCTURED_LOGGER) private readonly logger: Logger) {}

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const incomingRequestId = request.header("x-request-id");
    const requestId =
      incomingRequestId && requestIdPattern.test(incomingRequestId)
        ? incomingRequestId
        : randomUUID();
    const startedAt = process.hrtime.bigint();

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    response.once("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.logger.info({
        duration_ms: Number(durationMs.toFixed(3)),
        event: "http.request.completed",
        method: request.method,
        path: request.path,
        request_id: requestId,
        status_code: response.statusCode,
      });
    });

    next();
  }
}
