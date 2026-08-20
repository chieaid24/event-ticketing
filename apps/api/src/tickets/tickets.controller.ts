import {
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import type {
  QrRevealResponse,
  TicketListResponse,
  TicketSummary,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, TICKETS_SERVICE } from "../runtime.tokens.js";
import type { TicketsService } from "./tickets.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  getTicket: { max: 600, windowMs: 15 * 60 * 1000 },
  listTickets: { max: 300, windowMs: 15 * 60 * 1000 },
  revealQr: { max: 120, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller()
export class TicketsController {
  constructor(
    @Inject(TICKETS_SERVICE) private readonly service: TicketsService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Get("account/tickets")
  async listTickets(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<TicketListResponse> {
    await this.enforceLimit(request, "listTickets", routeLimits.listTickets);
    sealResponse(response);
    return this.service.listTickets(contextFrom(request));
  }

  @Get("tickets/:ticketId")
  async getTicket(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("ticketId") ticketId: string
  ): Promise<TicketSummary> {
    await this.enforceLimit(request, "getTicket", routeLimits.getTicket);
    sealResponse(response);
    return this.service.getTicket(contextFrom(request), ticketId);
  }

  @Post("tickets/:ticketId/qr")
  async revealQr(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("ticketId") ticketId: string
  ): Promise<QrRevealResponse> {
    await this.enforceLimit(request, "revealQr", routeLimits.revealQr);
    sealResponse(response);
    return this.service.revealQr(contextFrom(request), ticketId);
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `tickets:${route}:${client}`,
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

// owner ticket data must stay private
function sealResponse(response: Response): void {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
}
