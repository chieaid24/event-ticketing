import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";

import type {
  AcceptedResponse,
  OperationsJobListResponse,
  OrganizationAnalyticsResponse,
} from "@event-ticketing/contracts";

import { contextFrom } from "../request-context.js";
import { OPERATIONS_SERVICE } from "../runtime.tokens.js";
import type { OperationsService } from "./operations.service.js";

@Controller()
export class OperationsController {
  constructor(
    @Inject(OPERATIONS_SERVICE) private readonly service: OperationsService
  ) {}

  @Get("organizations/:organizationId/analytics")
  async organizationAnalytics(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Query() query: unknown
  ): Promise<OrganizationAnalyticsResponse> {
    return this.service.getOrganizationAnalytics(
      contextFrom(request),
      organizationId,
      query
    );
  }

  @Get("organizations/:organizationId/jobs")
  async organizationJobs(
    @Req() request: Request,
    @Param("organizationId") organizationId: string
  ): Promise<OperationsJobListResponse> {
    return this.service.listOrganizationJobs(
      contextFrom(request),
      organizationId
    );
  }

  @Post("organizations/:organizationId/jobs/:jobId/retry")
  @HttpCode(202)
  async retryOrganizationJob(
    @Req() request: Request,
    @Param("organizationId") organizationId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown
  ): Promise<AcceptedResponse> {
    return this.service.retryOrganizationJob(
      contextFrom(request),
      organizationId,
      jobId,
      body
    );
  }

  @Get("admin/jobs")
  async platformJobs(
    @Req() request: Request
  ): Promise<OperationsJobListResponse> {
    return this.service.listPlatformJobs(contextFrom(request));
  }

  @Post("admin/jobs/:jobId/retry")
  @HttpCode(202)
  async retryPlatformJob(
    @Req() request: Request,
    @Param("jobId") jobId: string,
    @Body() body: unknown
  ): Promise<AcceptedResponse> {
    return this.service.retryPlatformJob(contextFrom(request), jobId, body);
  }
}
