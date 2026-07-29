import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type { WebhookAck } from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import {
  AUTH_RATE_LIMITER,
  PAYMENTS_SIMULATION_SERVICE,
} from "../runtime.tokens.js";
import type { PaymentsSimulationService } from "./payments-simulation.service.js";

/** Registered only when the fake payment provider is configured. */
@Controller("payments")
export class PaymentsSimulationController {
  constructor(
    @Inject(PAYMENTS_SIMULATION_SERVICE)
    private readonly service: PaymentsSimulationService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post("simulate")
  @HttpCode(202)
  async simulate(
    @Req() request: Request,
    @Body() body: unknown
  ): Promise<WebhookAck> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `payments:simulate:${client}`,
      60,
      15 * 60 * 1000
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
    return this.service.simulate(contextFrom(request), body);
  }
}
