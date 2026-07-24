import { Controller, Get } from "@nestjs/common";

import type { StatusResponse } from "@event-ticketing/contracts";

@Controller()
export class StatusController {
  @Get("status")
  status(): StatusResponse {
    return {
      service: "api",
      status: "available",
      version: 1,
    };
  }
}
