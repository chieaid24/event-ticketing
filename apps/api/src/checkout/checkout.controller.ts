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
} from "@nestjs/common";
import type { Request } from "express";

import type { OrderSummary } from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, CHECKOUT_SERVICE } from "../runtime.tokens.js";
import type { CheckoutService } from "./checkout.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  // polling budget: processing page reads order every few seconds
  getOrder: { max: 600, windowMs: 15 * 60 * 1000 },
  startCheckout: { max: 60, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller()
export class CheckoutController {
  constructor(
    @Inject(CHECKOUT_SERVICE) private readonly service: CheckoutService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post("checkout")
  @HttpCode(201)
  async startCheckout(
    @Req() request: Request,
    @Body() body: unknown
  ): Promise<OrderSummary> {
    await this.enforceLimit(
      request,
      "startCheckout",
      routeLimits.startCheckout
    );
    return this.service.startCheckout(contextFrom(request), body);
  }

  @Get("orders/:orderId")
  async getOrder(
    @Req() request: Request,
    @Param("orderId") orderId: string
  ): Promise<OrderSummary> {
    await this.enforceLimit(request, "getOrder", routeLimits.getOrder);
    return this.service.getOrder(contextFrom(request), orderId);
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `checkout:${route}:${client}`,
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
