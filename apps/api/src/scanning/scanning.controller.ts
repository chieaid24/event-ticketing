import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import type {
  CheckInResponse,
  ReversalResponse,
  ScanActivityResponse,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, SCANNING_SERVICE } from "../runtime.tokens.js";
import type { ScanningService } from "./scanning.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

/**
 * Per-address limits stay generous because a venue's scanner devices often
 * share one network address; the service's per-device and per-actor limits
 * are the tight gate.
 */
const routeLimits = {
  activity: { max: 2400, windowMs: 15 * 60 * 1000 },
  checkIn: { max: 6000, windowMs: 15 * 60 * 1000 },
  reversal: { max: 240, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller("organizations/:organizationId/events/:eventId/scanner")
export class ScanningController {
  constructor(
    @Inject(SCANNING_SERVICE) private readonly service: ScanningService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post("checkins")
  @HttpCode(200)
  async checkIn(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown
  ): Promise<CheckInResponse> {
    await this.enforceLimit(request, "checkIn", routeLimits.checkIn);
    sealResponse(response);
    return this.service.checkIn(
      contextFrom(request),
      organizationId,
      eventId,
      body
    );
  }

  @Post("reversals")
  @HttpCode(200)
  async reverse(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown
  ): Promise<ReversalResponse> {
    await this.enforceLimit(request, "reversal", routeLimits.reversal);
    sealResponse(response);
    return this.service.reverse(
      contextFrom(request),
      organizationId,
      eventId,
      body
    );
  }

  @Get("activity")
  async activity(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string
  ): Promise<ScanActivityResponse> {
    await this.enforceLimit(request, "activity", routeLimits.activity);
    sealResponse(response);
    return this.service.activity(contextFrom(request), organizationId, eventId);
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `scanner:${route}:${client}`,
      limit.max,
      limit.windowMs
    );
    if (!allowed) {
      throw new HttpException(
        {
          code: "rate_limited",
          message: "Too many requests. Try again later.",
        },
        429
      );
    }
  }
}

/**
 * Scan results reference attendees and admission state: operational data that
 * must never be cached by a shared proxy or indexed by a crawler.
 */
function sealResponse(response: Response): void {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
}
