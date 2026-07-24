import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import type { Response } from "express";

import { HealthService, type ReadinessResponse } from "./health.service.js";

export interface LivenessResponse {
  service: "api";
  status: "live";
}

@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get("live")
  @Header("cache-control", "no-store")
  liveness(): LivenessResponse {
    return {
      service: "api",
      status: "live",
    };
  }

  @Get("ready")
  @Header("cache-control", "no-store")
  async readiness(
    @Res({ passthrough: true }) response: Response
  ): Promise<ReadinessResponse> {
    const readiness = await this.health.readiness();
    response.status(readiness.status === "ready" ? 200 : 503);
    return readiness;
  }
}
