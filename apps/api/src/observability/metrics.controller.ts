import { Controller, Get, Header, Inject } from "@nestjs/common";

import { HTTP_METRICS, OPERATIONS_STORE } from "../runtime.tokens.js";
import type { HttpMetrics } from "./http-metrics.js";
import type { OperationsStore } from "../operations/operations.store.js";

@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(HTTP_METRICS) private readonly metrics: HttpMetrics,
    @Inject(OPERATIONS_STORE) private readonly operations: OperationsStore
  ) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async get(): Promise<string> {
    const outbox = await this.operations.outboxMetrics();
    return `${this.metrics.render()}# HELP event_ticketing_outbox_jobs Current outbox jobs by state.
# TYPE event_ticketing_outbox_jobs gauge
event_ticketing_outbox_jobs{state="pending_ready"} ${outbox.pendingReady}
event_ticketing_outbox_jobs{state="pending_delayed"} ${outbox.pendingDelayed}
event_ticketing_outbox_jobs{state="processing"} ${outbox.processing}
event_ticketing_outbox_jobs{state="dead_letter"} ${outbox.deadLetter}
event_ticketing_outbox_jobs{state="retrying"} ${outbox.retrying}
# HELP event_ticketing_outbox_oldest_ready_age_seconds Age of the oldest ready job.
# TYPE event_ticketing_outbox_oldest_ready_age_seconds gauge
event_ticketing_outbox_oldest_ready_age_seconds ${outbox.oldestReadyAgeSeconds}
`;
  }
}
