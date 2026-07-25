import {
  Body,
  Controller,
  Delete,
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
  AcceptedResponse,
  VenueDetailResponse,
  VenueListResponse,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, VENUES_SERVICE } from "../runtime.tokens.js";
import type { VenuesService } from "./venues.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  create: { max: 30, windowMs: 60 * 60 * 1000 },
  layout: { max: 60, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller("organizations/:organizationId/venues")
export class VenuesController {
  constructor(
    @Inject(VENUES_SERVICE) private readonly service: VenuesService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown
  ): Promise<VenueDetailResponse> {
    await this.enforceLimit(request, "create", routeLimits.create);
    return this.service.createVenue(contextFrom(request), organizationId, body);
  }

  @Get()
  async list(
    @Req() request: Request,
    @Param("organizationId") organizationId: string
  ): Promise<VenueListResponse> {
    return this.service.listVenues(contextFrom(request), organizationId);
  }

  @Get(":venueId")
  async get(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("venueId") venueId: string
  ): Promise<VenueDetailResponse> {
    return this.service.getVenue(contextFrom(request), organizationId, venueId);
  }

  @Patch(":venueId")
  @HttpCode(200)
  async update(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("venueId") venueId: string,
    @Body() body: unknown
  ): Promise<VenueDetailResponse> {
    return this.service.updateVenue(
      contextFrom(request),
      organizationId,
      venueId,
      body
    );
  }

  @Put(":venueId/layout")
  @HttpCode(200)
  async replaceLayout(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("venueId") venueId: string,
    @Body() body: unknown
  ): Promise<VenueDetailResponse> {
    await this.enforceLimit(request, "layout", routeLimits.layout);
    return this.service.replaceLayout(
      contextFrom(request),
      organizationId,
      venueId,
      body
    );
  }

  @Delete(":venueId")
  @HttpCode(200)
  async remove(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("venueId") venueId: string
  ): Promise<AcceptedResponse> {
    return this.service.deleteVenue(
      contextFrom(request),
      organizationId,
      venueId
    );
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `venues:${route}:${client}`,
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
