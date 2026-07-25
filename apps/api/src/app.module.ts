import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import type { Logger } from "pino";

import type { ApiConfig } from "@event-ticketing/config";

import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { PgAuthStore } from "./auth/auth.store.js";
import { RedisRateLimiter } from "./auth/rate-limiter.js";
import {
  DatabaseHealthDependency,
  RedisHealthDependency,
} from "./dependency-health.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { RequestLoggingMiddleware } from "./request-logging.middleware.js";
import {
  AUTH_COOKIE_SETTINGS,
  AUTH_RATE_LIMITER,
  AUTH_SERVICE,
  AUTH_STORE,
  DATABASE_HEALTH,
  REDIS_HEALTH,
  STRUCTURED_LOGGER,
} from "./runtime.tokens.js";
import { StatusController } from "./status.controller.js";

@Module({})
export class AppModule implements NestModule {
  static register(config: ApiConfig, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, HealthController, StatusController],
      providers: [
        {
          provide: AUTH_STORE,
          useFactory: () => new PgAuthStore(config.databaseUrl),
        },
        {
          provide: AUTH_RATE_LIMITER,
          useFactory: () =>
            new RedisRateLimiter(
              config.redisUrl,
              config.dependencyTimeoutMs,
              logger
            ),
        },
        {
          inject: [AUTH_STORE],
          provide: AUTH_SERVICE,
          useFactory: (store: PgAuthStore) =>
            new AuthService(store, {
              sessionAbsoluteTtlSeconds: config.sessionAbsoluteTtlSeconds,
              sessionIdleTtlSeconds: config.sessionIdleTtlSeconds,
              trustedOrigins: config.trustedOrigins,
            }),
        },
        {
          provide: AUTH_COOKIE_SETTINGS,
          useValue: {
            maxAgeSeconds: config.sessionAbsoluteTtlSeconds,
            secure: config.cookieSecure,
          },
        },
        {
          provide: DATABASE_HEALTH,
          useFactory: () =>
            new DatabaseHealthDependency(
              config.databaseUrl,
              config.dependencyTimeoutMs
            ),
        },
        {
          provide: REDIS_HEALTH,
          useFactory: () =>
            new RedisHealthDependency(
              config.redisUrl,
              config.dependencyTimeoutMs
            ),
        },
        {
          provide: STRUCTURED_LOGGER,
          useValue: logger,
        },
        {
          inject: [DATABASE_HEALTH, REDIS_HEALTH],
          provide: HealthService,
          useFactory: (
            database: DatabaseHealthDependency,
            redis: RedisHealthDependency
          ) => new HealthService(database, redis, config.dependencyTimeoutMs),
        },
        RequestLoggingMiddleware,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes("*");
  }
}
