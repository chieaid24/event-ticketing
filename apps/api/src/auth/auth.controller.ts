import {
  Body,
  Controller,
  Delete,
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
  AcceptedResponse,
  ChangePasswordResponse,
  LoginResponse,
  MeResponse,
  ResetPasswordResponse,
  SessionListResponse,
  VerifyEmailResponse,
} from "@event-ticketing/contracts";

import {
  buildClearedSessionCookies,
  buildSessionCookies,
  type AuthCookieSettings,
} from "./cookies.js";
import type { AuthService } from "./auth.service.js";
import type { RateLimiter } from "./rate-limiter.js";
import { contextFrom, deviceSummaryFrom } from "../request-context.js";
import {
  AUTH_COOKIE_SETTINGS,
  AUTH_RATE_LIMITER,
  AUTH_SERVICE,
} from "../runtime.tokens.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  forgotPassword: { max: 5, windowMs: 15 * 60 * 1000 },
  login: { max: 10, windowMs: 60 * 1000 },
  register: { max: 10, windowMs: 15 * 60 * 1000 },
  resetPassword: { max: 10, windowMs: 15 * 60 * 1000 },
  verifyEmail: { max: 20, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly service: AuthService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(AUTH_COOKIE_SETTINGS)
    private readonly cookieSettings: AuthCookieSettings
  ) {}

  @Post("register")
  @HttpCode(202)
  async register(
    @Req() request: Request,
    @Body() body: unknown
  ): Promise<AcceptedResponse> {
    await this.enforceLimit(request, "register", routeLimits.register);
    return this.service.register(body);
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(
    @Req() request: Request,
    @Body() body: unknown
  ): Promise<VerifyEmailResponse> {
    await this.enforceLimit(request, "verify-email", routeLimits.verifyEmail);
    return this.service.verifyEmail(body);
  }

  @Post("login")
  @HttpCode(200)
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown
  ): Promise<LoginResponse> {
    await this.enforceLimit(request, "login", routeLimits.login);
    const { secrets, user } = await this.service.login(
      body,
      deviceSummaryFrom(request)
    );
    response.setHeader(
      "Set-Cookie",
      buildSessionCookies(secrets, this.cookieSettings)
    );
    return { user };
  }

  @Get("me")
  async me(@Req() request: Request): Promise<MeResponse> {
    return this.service.me(contextFrom(request));
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<AcceptedResponse> {
    const result = await this.service.logout(contextFrom(request));
    response.setHeader(
      "Set-Cookie",
      buildClearedSessionCookies(this.cookieSettings)
    );
    return result;
  }

  @Post("forgot-password")
  @HttpCode(202)
  async forgotPassword(
    @Req() request: Request,
    @Body() body: unknown
  ): Promise<AcceptedResponse> {
    await this.enforceLimit(
      request,
      "forgot-password",
      routeLimits.forgotPassword
    );
    return this.service.forgotPassword(body);
  }

  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(
    @Req() request: Request,
    @Body() body: unknown
  ): Promise<ResetPasswordResponse> {
    await this.enforceLimit(
      request,
      "reset-password",
      routeLimits.resetPassword
    );
    return this.service.resetPassword(body);
  }

  @Post("change-password")
  @HttpCode(200)
  async changePassword(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown
  ): Promise<ChangePasswordResponse> {
    const { response: result, secrets } = await this.service.changePassword(
      contextFrom(request),
      body,
      deviceSummaryFrom(request)
    );
    response.setHeader(
      "Set-Cookie",
      buildSessionCookies(secrets, this.cookieSettings)
    );
    return result;
  }

  @Get("sessions")
  async listSessions(@Req() request: Request): Promise<SessionListResponse> {
    return this.service.listSessions(contextFrom(request));
  }

  @Delete("sessions/:id")
  @HttpCode(200)
  async revokeSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") sessionId: string
  ): Promise<AcceptedResponse> {
    const { currentRevoked, response: result } =
      await this.service.revokeSession(contextFrom(request), sessionId);
    if (currentRevoked) {
      response.setHeader(
        "Set-Cookie",
        buildClearedSessionCookies(this.cookieSettings)
      );
    }
    return result;
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `auth:${route}:${client}`,
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
