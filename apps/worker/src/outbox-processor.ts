import type {
  OutboxEvent,
  OutboxFailure,
  OutboxMetrics,
} from "@event-ticketing/database";

export interface OutboxStore {
  claimBatch(input: {
    batchSize: number;
    leaseMs: number;
    workerId: string;
  }): Promise<OutboxEvent[]>;
  completeEvent(input: {
    eventId: string;
    handlerName: string;
    workerId: string;
  }): Promise<void>;
  failEvent(input: {
    errorCode: string;
    eventId: string;
    retryDelayMs: number;
    workerId: string;
  }): Promise<OutboxFailure>;
  hasHandlerReceipt(eventId: string): Promise<boolean>;
  materializeDueSchedules(limit: number): Promise<number>;
  metrics(): Promise<OutboxMetrics>;
  releaseClaims(workerId: string): Promise<number>;
}

export interface OutboxHandlerContext {
  eventId: string;
  idempotencyKey: string;
}

export type OutboxHandler = (
  event: OutboxEvent,
  context: OutboxHandlerContext
) => Promise<void>;

export interface OutboxCycleResult {
  claimed: number;
  completed: number;
  deadLettered: number;
  materialized: number;
  metrics: OutboxMetrics;
  retried: number;
}

export interface OutboxProcessor {
  processOnce(): Promise<OutboxCycleResult>;
  stop(): Promise<number>;
}

export class OutboxHandlerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "OutboxHandlerError";
    this.code = code;
  }
}

export function calculateRetryDelayMs(
  attemptCount: number,
  baseDelayMs: number,
  maximumDelayMs: number
): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(maximumDelayMs, baseDelayMs * 2 ** exponent);
}

function errorCode(error: unknown): string {
  return error instanceof OutboxHandlerError &&
    /^[a-z][a-z0-9_]{0,79}$/.test(error.code)
    ? error.code
    : "handler_failed";
}

export function createOutboxProcessor(input: {
  batchSize: number;
  handlers: Readonly<Record<string, OutboxHandler>>;
  leaseMs: number;
  repository: OutboxStore;
  retryBaseDelayMs: number;
  retryMaximumDelayMs: number;
  workerId: string;
}): OutboxProcessor {
  let active: Promise<OutboxCycleResult> | undefined;
  let stopping = false;

  async function runCycle(): Promise<OutboxCycleResult> {
    const materialized = await input.repository.materializeDueSchedules(
      input.batchSize
    );
    const events = await input.repository.claimBatch({
      batchSize: input.batchSize,
      leaseMs: input.leaseMs,
      workerId: input.workerId,
    });
    let completed = 0;
    let deadLettered = 0;
    let retried = 0;

    for (const event of events) {
      if (stopping) {
        break;
      }

      try {
        const alreadyHandled = await input.repository.hasHandlerReceipt(
          event.id
        );

        if (!alreadyHandled) {
          const handler = input.handlers[event.topic];

          if (!handler) {
            throw new OutboxHandlerError("handler_not_registered");
          }

          await handler(event, {
            eventId: event.id,
            idempotencyKey: event.id,
          });
        }

        await input.repository.completeEvent({
          eventId: event.id,
          handlerName: event.topic,
          workerId: input.workerId,
        });
        completed += 1;
      } catch (error) {
        const failure = await input.repository.failEvent({
          errorCode: errorCode(error),
          eventId: event.id,
          retryDelayMs: calculateRetryDelayMs(
            event.attemptCount,
            input.retryBaseDelayMs,
            input.retryMaximumDelayMs
          ),
          workerId: input.workerId,
        });

        if (failure.status === "dead_letter") {
          deadLettered += 1;
        } else {
          retried += 1;
        }
      }
    }

    return {
      claimed: events.length,
      completed,
      deadLettered,
      materialized,
      metrics: await input.repository.metrics(),
      retried,
    };
  }

  return {
    async processOnce() {
      if (stopping) {
        throw new Error("The outbox processor is stopping.");
      }

      active = runCycle();

      try {
        return await active;
      } finally {
        active = undefined;
      }
    },
    async stop() {
      stopping = true;
      await active?.catch(() => undefined);
      return input.repository.releaseClaims(input.workerId);
    },
  };
}
