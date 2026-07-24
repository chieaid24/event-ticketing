import {
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import type { Logger } from "pino";

import type { ApiConfig } from "@event-ticketing/config";

import {
  DatabaseHealthDependency,
  RedisHealthDependency,
} from "./dependency-health.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { RequestLoggingMiddleware } from "./request-logging.middleware.js";
import {
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
      controllers: [HealthController, StatusController],
      providers: [
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
