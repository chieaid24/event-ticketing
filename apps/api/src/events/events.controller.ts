import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type {
  EventDetailResponse,
  EventListResponse,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, EVENTS_SERVICE } from "../runtime.tokens.js";
import type { EventsService } from "./events.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  create: { max: 30, windowMs: 60 * 60 * 1000 },
  publish: { max: 20, windowMs: 60 * 60 * 1000 },
  ticketTypes: { max: 60, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller("organizations/:organizationId/events")
export class EventsController {
  constructor(
    @Inject(EVENTS_SERVICE) private readonly service: EventsService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown
  ): Promise<EventDetailResponse> {
    await this.enforceLimit(request, "create", routeLimits.create);
    return this.service.createEvent(contextFrom(request), organizationId, body);
  }

  @Get()
  async list(
    @Req() request: Request,
    @Param("organizationId") organizationId: string
  ): Promise<EventListResponse> {
    return this.service.listEvents(contextFrom(request), organizationId);
  }

  @Get(":eventId")
  async get(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string
  ): Promise<EventDetailResponse> {
    return this.service.getEvent(contextFrom(request), organizationId, eventId);
  }

  @Patch(":eventId")
  @HttpCode(200)
  async update(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown
  ): Promise<EventDetailResponse> {
    return this.service.updateDraft(
      contextFrom(request),
      organizationId,
      eventId,
      body
    );
  }

  @Put(":eventId/ticket-types")
  @HttpCode(200)
  async replaceTicketTypes(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown
  ): Promise<EventDetailResponse> {
    await this.enforceLimit(request, "ticketTypes", routeLimits.ticketTypes);
    return this.service.replaceTicketTypes(
      contextFrom(request),
      organizationId,
      eventId,
      body
    );
  }

  @Post(":eventId/publish")
  @HttpCode(200)
  async publish(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown
  ): Promise<EventDetailResponse> {
    await this.enforceLimit(request, "publish", routeLimits.publish);
    return this.service.publishEvent(
      contextFrom(request),
      organizationId,
      eventId,
      body
    );
  }

  @Post(":eventId/cancel")
  @HttpCode(200)
  async cancel(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown
  ): Promise<EventDetailResponse> {
    await this.enforceLimit(request, "cancel", routeLimits.publish);
    return this.service.cancelEvent(
      contextFrom(request),
      organizationId,
      eventId,
      body
    );
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `events:${route}:${client}`,
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
