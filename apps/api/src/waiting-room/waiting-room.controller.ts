import {
  Controller,
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
  WaitingRoomHeartbeatResponse,
  WaitingRoomQueueResponse,
  WaitingRoomStatusResponse,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, WAITING_ROOM_SERVICE } from "../runtime.tokens.js";
import type { WaitingRoomService } from "./waiting-room.service.js";

const WINDOW_MS = 60_000;

@Controller("waiting-room/events/:eventId")
export class WaitingRoomController {
  constructor(
    @Inject(WAITING_ROOM_SERVICE) private readonly service: WaitingRoomService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post("join")
  @HttpCode(201)
  async join(
    @Req() request: Request,
    @Param("eventId") eventId: string
  ): Promise<WaitingRoomQueueResponse> {
    await this.limit(request, "join", 20);
    return this.service.join(contextFrom(request), eventId);
  }

  @Post("heartbeat")
  @HttpCode(200)
  async heartbeat(
    @Req() request: Request,
    @Param("eventId") eventId: string,
    @Headers("x-waiting-room-token") token: string | undefined
  ): Promise<WaitingRoomHeartbeatResponse> {
    await this.limit(request, "heartbeat", 120);
    return this.service.heartbeat(contextFrom(request), eventId, token);
  }

  @Post("status")
  @HttpCode(200)
  async status(
    @Req() request: Request,
    @Param("eventId") eventId: string,
    @Headers("x-waiting-room-token") token: string | undefined
  ): Promise<WaitingRoomStatusResponse> {
    await this.limit(request, "status", 120);
    return this.service.status(contextFrom(request), eventId, token);
  }

  private async limit(
    request: Request,
    route: string,
    max: number
  ): Promise<void> {
    const allowed = await this.rateLimiter.consume(
      `waiting-room:${route}:${request.ip ?? "unknown"}`,
      max,
      WINDOW_MS
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
