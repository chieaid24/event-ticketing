import { randomUUID } from "node:crypto";

import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";

import type { HttpMetrics } from "./observability/http-metrics.js";
import { HTTP_METRICS, STRUCTURED_LOGGER } from "./runtime.tokens.js";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const traceparentPattern = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

export interface RequestWithId extends Request {
  requestId: string;
  traceId: string;
}

function metricPath(request: RequestWithId): string {
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === "string"
    ? `${request.baseUrl}${route.path}`
    : "/unmatched";
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(
    @Inject(STRUCTURED_LOGGER) private readonly logger: Logger,
    @Inject(HTTP_METRICS) private readonly metrics: HttpMetrics
  ) {}

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const incomingRequestId = request.header("x-request-id");
    const requestId =
      incomingRequestId && requestIdPattern.test(incomingRequestId)
        ? incomingRequestId
        : randomUUID();
    const startedAt = process.hrtime.bigint();
    const traceparent = request.header("traceparent");
    const traceId =
      (traceparent ? traceparentPattern.exec(traceparent)?.[1] : undefined) ??
      randomUUID().replaceAll("-", "");

    request.requestId = requestId;
    request.traceId = traceId;
    response.setHeader("x-request-id", requestId);
    response.setHeader("x-trace-id", traceId);
    response.once("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.metrics.record({
        durationSeconds: durationMs / 1_000,
        method: request.method,
        path: metricPath(request),
        statusCode: response.statusCode,
      });
      this.logger.info({
        duration_ms: Number(durationMs.toFixed(3)),
        event: "http.request.completed",
        method: request.method,
        path: request.path,
        request_id: requestId,
        status_code: response.statusCode,
        trace_id: traceId,
      });
    });

    next();
  }
}
