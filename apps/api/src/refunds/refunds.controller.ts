import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type {
  RefundListResponse,
  RefundSummary,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, REFUNDS_SERVICE } from "../runtime.tokens.js";
import type { RefundsService } from "./refunds.service.js";

@Controller()
export class RefundsController {
  constructor(
    @Inject(REFUNDS_SERVICE) private readonly service: RefundsService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post("orders/:orderId/refunds")
  @HttpCode(202)
  async createCustomerRefund(
    @Req() request: Request,
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ): Promise<RefundSummary> {
    await this.enforceLimit(request, "customer");
    return this.service.createCustomerRefund(
      contextFrom(request),
      orderId,
      idempotencyKey,
      body
    );
  }

  @Get("orders/:orderId/refunds")
  async listCustomerRefunds(
    @Req() request: Request,
    @Param("orderId") orderId: string
  ): Promise<RefundListResponse> {
    return this.service.listCustomerRefunds(contextFrom(request), orderId);
  }

  @Post("organizations/:organizationId/orders/:orderId/refunds")
  @HttpCode(202)
  async createOrganizerRefund(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("orderId") orderId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ): Promise<RefundSummary> {
    await this.enforceLimit(request, "organizer");
    return this.service.createOrganizerRefund(
      contextFrom(request),
      organizationId,
      orderId,
      idempotencyKey,
      body
    );
  }

  private async enforceLimit(request: Request, route: string): Promise<void> {
    const allowed = await this.rateLimiter.consume(
      `refunds:${route}:${request.ip ?? "unknown"}`,
      30,
      15 * 60 * 1000
    );
    if (!allowed) {
      throw new HttpException(
        {
          code: "rate_limited",
          message: "Too many refund requests. Try again later.",
        },
        429
      );
    }
  }
}
