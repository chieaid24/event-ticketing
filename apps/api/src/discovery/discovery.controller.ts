import {
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type {
  EventAvailabilityResponse,
  PublicEventDetailResponse,
  PublicEventListResponse,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { AUTH_RATE_LIMITER, DISCOVERY_SERVICE } from "../runtime.tokens.js";
import type { DiscoveryService } from "./discovery.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  availability: { max: 120, windowMs: 60 * 1000 },
  detail: { max: 240, windowMs: 60 * 1000 },
  list: { max: 120, windowMs: 60 * 1000 },
} satisfies Record<string, RouteLimit>;

// public reads never resolve sessions
@Controller("discovery")
export class DiscoveryController {
  constructor(
    @Inject(DISCOVERY_SERVICE) private readonly service: DiscoveryService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Get("events")
  async list(
    @Req() request: Request,
    @Query() query: unknown
  ): Promise<PublicEventListResponse> {
    await this.enforceLimit(request, "list", routeLimits.list);
    return this.service.listEvents(query);
  }

  @Get("events/:eventId")
  async get(
    @Req() request: Request,
    @Param("eventId") eventId: string
  ): Promise<PublicEventDetailResponse> {
    await this.enforceLimit(request, "detail", routeLimits.detail);
    return this.service.getEvent(eventId);
  }

  @Get("events/:eventId/availability")
  async availability(
    @Req() request: Request,
    @Param("eventId") eventId: string
  ): Promise<EventAvailabilityResponse> {
    await this.enforceLimit(request, "availability", routeLimits.availability);
    return this.service.getAvailability(eventId);
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `discovery:${route}:${client}`,
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
