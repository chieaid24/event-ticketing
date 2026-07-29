import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type {
  CreateAssignedSeatHoldResponse,
  CreateGeneralAdmissionHoldResponse,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, HOLDS_SERVICE } from "../runtime.tokens.js";
import type { HoldsService } from "./holds.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  createAssigned: { max: 60, windowMs: 15 * 60 * 1000 },
  createGeneralAdmission: { max: 60, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller("holds")
export class HoldsController {
  constructor(
    @Inject(HOLDS_SERVICE) private readonly service: HoldsService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post("assigned")
  @HttpCode(201)
  async createAssigned(
    @Req() request: Request,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ): Promise<CreateAssignedSeatHoldResponse> {
    await this.enforceLimit(
      request,
      "createAssigned",
      routeLimits.createAssigned
    );
    return this.service.createAssignedSeatHold(
      contextFrom(request),
      idempotencyKey,
      body
    );
  }

  @Post("general-admission")
  @HttpCode(201)
  async createGeneralAdmission(
    @Req() request: Request,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ): Promise<CreateGeneralAdmissionHoldResponse> {
    await this.enforceLimit(
      request,
      "createGeneralAdmission",
      routeLimits.createGeneralAdmission
    );
    return this.service.createGeneralAdmissionHold(
      contextFrom(request),
      idempotencyKey,
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
      `holds:${route}:${client}`,
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
