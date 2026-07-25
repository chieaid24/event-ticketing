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
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type {
  AcceptedResponse,
  AuditLogListResponse,
  MemberListResponse,
  OrganizationDetailResponse,
  OrganizationListResponse,
} from "@event-ticketing/contracts";

import type { RateLimiter } from "../auth/rate-limiter.js";
import { contextFrom } from "../request-context.js";
import { AUTH_RATE_LIMITER, ORGANIZATIONS_SERVICE } from "../runtime.tokens.js";
import type { OrganizationsService } from "./organizations.service.js";

interface RouteLimit {
  max: number;
  windowMs: number;
}

const routeLimits = {
  create: { max: 10, windowMs: 60 * 60 * 1000 },
  invite: { max: 30, windowMs: 15 * 60 * 1000 },
} satisfies Record<string, RouteLimit>;

@Controller("organizations")
export class OrganizationsController {
  constructor(
    @Inject(ORGANIZATIONS_SERVICE)
    private readonly service: OrganizationsService,
    @Inject(AUTH_RATE_LIMITER) private readonly rateLimiter: RateLimiter
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() request: Request,
    @Body() body: unknown
  ): Promise<OrganizationDetailResponse> {
    await this.enforceLimit(request, "create", routeLimits.create);
    return this.service.createOrganization(contextFrom(request), body);
  }

  @Get()
  async list(@Req() request: Request): Promise<OrganizationListResponse> {
    return this.service.listOrganizations(contextFrom(request));
  }

  @Post("invitations/:membershipId/accept")
  @HttpCode(200)
  async acceptInvitation(
    @Req() request: Request,
    @Param("membershipId") membershipId: string
  ): Promise<AcceptedResponse> {
    return this.service.respondToInvitation(
      contextFrom(request),
      membershipId,
      "accept"
    );
  }

  @Post("invitations/:membershipId/decline")
  @HttpCode(200)
  async declineInvitation(
    @Req() request: Request,
    @Param("membershipId") membershipId: string
  ): Promise<AcceptedResponse> {
    return this.service.respondToInvitation(
      contextFrom(request),
      membershipId,
      "decline"
    );
  }

  @Get(":organizationId")
  async get(
    @Req() request: Request,
    @Param("organizationId") organizationId: string
  ): Promise<OrganizationDetailResponse> {
    return this.service.getOrganization(contextFrom(request), organizationId);
  }

  @Patch(":organizationId")
  @HttpCode(200)
  async updateSettings(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown
  ): Promise<OrganizationDetailResponse> {
    return this.service.updateSettings(
      contextFrom(request),
      organizationId,
      body
    );
  }

  @Delete(":organizationId")
  @HttpCode(200)
  async remove(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown
  ): Promise<AcceptedResponse> {
    return this.service.deleteOrganization(
      contextFrom(request),
      organizationId,
      body
    );
  }

  @Get(":organizationId/members")
  async listMembers(
    @Req() request: Request,
    @Param("organizationId") organizationId: string
  ): Promise<MemberListResponse> {
    return this.service.listMembers(contextFrom(request), organizationId);
  }

  @Post(":organizationId/members")
  @HttpCode(202)
  async inviteMember(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Body() body: unknown
  ): Promise<AcceptedResponse> {
    await this.enforceLimit(request, "invite", routeLimits.invite);
    return this.service.inviteMember(
      contextFrom(request),
      organizationId,
      body
    );
  }

  @Patch(":organizationId/members/:membershipId")
  @HttpCode(200)
  async changeMemberRole(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: unknown
  ): Promise<AcceptedResponse> {
    return this.service.changeMemberRole(
      contextFrom(request),
      organizationId,
      membershipId,
      body
    );
  }

  @Delete(":organizationId/members/:membershipId")
  @HttpCode(200)
  async removeMember(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string
  ): Promise<AcceptedResponse> {
    return this.service.removeMember(
      contextFrom(request),
      organizationId,
      membershipId
    );
  }

  @Get(":organizationId/audit-logs")
  async listAuditLogs(
    @Req() request: Request,
    @Param("organizationId") organizationId: string
  ): Promise<AuditLogListResponse> {
    return this.service.listAuditLogs(contextFrom(request), organizationId);
  }

  private async enforceLimit(
    request: Request,
    route: string,
    limit: RouteLimit
  ): Promise<void> {
    const client = request.ip ?? "unknown";
    const allowed = await this.rateLimiter.consume(
      `organizations:${route}:${client}`,
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
