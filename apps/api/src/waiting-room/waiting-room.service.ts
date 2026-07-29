import { randomUUID } from "node:crypto";

import { HttpException } from "@nestjs/common";
import type { Logger } from "pino";

import type {
  WaitingRoomHeartbeatResponse,
  WaitingRoomQueueResponse,
  WaitingRoomStatusResponse,
} from "@event-ticketing/contracts";

import type { AuthService, RequestAuthContext } from "../auth/auth.service.js";
import { uuidPattern } from "../request-validation.js";
import type { WaitingRoomStore } from "./waiting-room.store.js";
import { InvalidWaitingRoomTokenError } from "./waiting-room-tokens.js";
import type { WaitingRoomTokens } from "./waiting-room-tokens.js";

export interface WaitingRoomOptions {
  admissionCapacity: number;
  heartbeatTtlSeconds: number;
  leaseTtlSeconds: number;
  tokenTtlSeconds: number;
}

export interface WaitingRoomAdmission {
  requireAdmission(input: {
    eventId: string;
    idempotencyKey: string;
    sessionId: string;
    token: string | undefined;
  }): Promise<void>;
}

export class WaitingRoomService implements WaitingRoomAdmission {
  constructor(
    private readonly auth: AuthService,
    private readonly store: WaitingRoomStore,
    private readonly tokens: WaitingRoomTokens,
    private readonly options: WaitingRoomOptions,
    private readonly logger: Logger
  ) {}

  async join(
    context: RequestAuthContext,
    eventId: string
  ): Promise<WaitingRoomQueueResponse> {
    this.requireEventId(eventId);
    const { session } = await this.auth.requireMutationSession(context);
    await this.requireEnabled(eventId);
    const now = Date.now();
    const position = await this.withRedis(() =>
      this.store.join({
        eventId,
        heartbeatExpiresAt: now + this.options.heartbeatTtlSeconds * 1_000,
        joinedAt: now,
        sessionId: session.id,
      })
    );
    this.logger.info({
      event: "waiting_room.joined",
      eventId,
      position: position.position,
      queueDepth: position.queueDepth,
    });
    return {
      eventId,
      joinedAt: new Date(position.joinedAt).toISOString(),
      position: position.position,
      queueDepth: position.queueDepth,
      queueToken: this.tokens.issue({
        eventId,
        expiresAt: now + this.options.tokenTtlSeconds * 1_000,
        joinedAt: position.joinedAt,
        kind: "queue",
        now,
        sessionId: session.id,
      }),
      status: "queued",
    };
  }

  async heartbeat(
    context: RequestAuthContext,
    eventId: string,
    token: string | undefined
  ): Promise<WaitingRoomHeartbeatResponse> {
    this.requireEventId(eventId);
    const { session } = await this.auth.requireMutationSession(context);
    const now = Date.now();
    this.verify(token, "queue", eventId, session.id, now);
    const expiresAt = now + this.options.heartbeatTtlSeconds * 1_000;
    const alive = await this.withRedis(() =>
      this.store.heartbeat({
        eventId,
        expiresAt,
        sessionId: session.id,
      })
    );
    if (!alive) {
      this.queueExpired();
    }
    return { expiresAt: new Date(expiresAt).toISOString(), status: "alive" };
  }

  async status(
    context: RequestAuthContext,
    eventId: string,
    token: string | undefined
  ): Promise<WaitingRoomStatusResponse> {
    this.requireEventId(eventId);
    const { session } = await this.auth.requireMutationSession(context);
    const now = Date.now();
    const claims = this.verify(token, "queue", eventId, session.id, now);
    const nonce = randomUUID();
    const admissionExpiresAt = now + this.options.leaseTtlSeconds * 1_000;
    const result = await this.withRedis(() =>
      this.store.statusAndAdmit({
        admissionCapacity: this.options.admissionCapacity,
        admissionExpiresAt,
        eventId,
        heartbeatExpiresAt: now + this.options.heartbeatTtlSeconds * 1_000,
        nonce,
        now,
        sessionId: session.id,
      })
    );

    if (result.kind === "queued") {
      return {
        eventId,
        joinedAt: new Date(result.joinedAt).toISOString(),
        position: result.position,
        queueDepth: result.queueDepth,
        queueToken: token!,
        status: "queued",
      };
    }

    const waitMs = Math.max(0, now - claims.joinedAt);
    this.logger.info({
      admissionRatePerMinute: result.admissionRatePerMinute,
      event: "waiting_room.admitted",
      eventId,
      queueDepth: result.queueDepth,
      waitMs,
    });
    return {
      admissionExpiresAt: new Date(admissionExpiresAt).toISOString(),
      admissionRatePerMinute: result.admissionRatePerMinute,
      admissionToken: this.tokens.issue({
        eventId,
        expiresAt: admissionExpiresAt,
        joinedAt: result.joinedAt,
        kind: "admission",
        nonce,
        now,
        sessionId: session.id,
      }),
      eventId,
      queueDepth: result.queueDepth,
      status: "admitted",
      waitMs,
    };
  }

  async requireAdmission(input: {
    eventId: string;
    idempotencyKey: string;
    sessionId: string;
    token: string | undefined;
  }): Promise<void> {
    const enabled = await this.store.eventRequiresAdmission(input.eventId);
    if (enabled !== true) {
      return;
    }
    const now = Date.now();
    const claims = this.verify(
      input.token,
      "admission",
      input.eventId,
      input.sessionId,
      now
    );
    const consumed = await this.withRedis(() =>
      this.store.consumeAdmission({
        eventId: input.eventId,
        expiresAt: claims.expiresAt,
        idempotencyKey: input.idempotencyKey,
        nonce: claims.nonce,
        now,
        sessionId: input.sessionId,
      })
    );
    if (!consumed) {
      this.invalidToken();
    }
  }

  private async requireEnabled(eventId: string): Promise<void> {
    const enabled = await this.store.eventRequiresAdmission(eventId);
    if (enabled === null) {
      throw new HttpException(
        { code: "event_not_found", message: "The event does not exist." },
        404
      );
    }
    if (!enabled) {
      throw new HttpException(
        {
          code: "waiting_room_not_enabled",
          message: "This event does not require a waiting room.",
        },
        409
      );
    }
  }

  private verify(
    token: string | undefined,
    kind: "queue" | "admission",
    eventId: string,
    sessionId: string,
    now: number
  ) {
    try {
      return this.tokens.verify(token, { eventId, kind, now, sessionId });
    } catch (error) {
      if (error instanceof InvalidWaitingRoomTokenError) {
        this.invalidToken();
      }
      throw error;
    }
  }

  private invalidToken(): never {
    throw new HttpException(
      {
        code: "waiting_room_token_invalid",
        message: "The waiting-room token is invalid or expired.",
      },
      403
    );
  }

  private queueExpired(): never {
    throw new HttpException(
      {
        code: "waiting_room_entry_expired",
        message: "The queue entry expired. Join the waiting room again.",
      },
      410
    );
  }

  private requireEventId(eventId: string): void {
    if (!uuidPattern.test(eventId)) {
      throw new HttpException(
        { code: "invalid_request", message: "The event id is invalid." },
        400
      );
    }
  }

  private async withRedis<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (
        error instanceof Error &&
        error.message === "Waiting-room queue entry expired."
      ) {
        this.queueExpired();
      }
      this.logger.error({ event: "waiting_room.redis_unavailable" });
      throw new HttpException(
        {
          code: "waiting_room_unavailable",
          message: "The waiting room is temporarily unavailable.",
        },
        503
      );
    }
  }
}
