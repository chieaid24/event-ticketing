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
import { DiscoveryController } from "./discovery/discovery.controller.js";
import { DiscoveryService } from "./discovery/discovery.service.js";
import { PgDiscoveryStore } from "./discovery/discovery.store.js";
import { EventsController } from "./events/events.controller.js";
import { EventsService } from "./events/events.service.js";
import { PgEventsStore } from "./events/events.store.js";
import { RedisHoldExpiryMirror } from "./holds/hold-expiry-mirror.js";
import { HoldsController } from "./holds/holds.controller.js";
import { HoldsService } from "./holds/holds.service.js";
import { PgHoldsStore } from "./holds/holds.store.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { OrganizationsController } from "./organizations/organizations.controller.js";
import { OrganizationsService } from "./organizations/organizations.service.js";
import { PgOrganizationsStore } from "./organizations/organizations.store.js";
import { RequestLoggingMiddleware } from "./request-logging.middleware.js";
import {
  AUTH_COOKIE_SETTINGS,
  AUTH_RATE_LIMITER,
  AUTH_SERVICE,
  AUTH_STORE,
  DATABASE_HEALTH,
  DISCOVERY_SERVICE,
  DISCOVERY_STORE,
  EVENTS_SERVICE,
  EVENTS_STORE,
  HOLD_EXPIRY_MIRROR,
  HOLDS_SERVICE,
  HOLDS_STORE,
  ORGANIZATIONS_SERVICE,
  ORGANIZATIONS_STORE,
  REDIS_HEALTH,
  STRUCTURED_LOGGER,
  VENUES_SERVICE,
  VENUES_STORE,
} from "./runtime.tokens.js";
import { StatusController } from "./status.controller.js";
import { VenuesController } from "./venues/venues.controller.js";
import { VenuesService } from "./venues/venues.service.js";
import { PgVenuesStore } from "./venues/venues.store.js";

@Module({})
export class AppModule implements NestModule {
  static register(config: ApiConfig, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        DiscoveryController,
        HealthController,
        OrganizationsController,
        StatusController,
        VenuesController,
        EventsController,
        HoldsController,
      ],
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
          provide: ORGANIZATIONS_STORE,
          useFactory: () => new PgOrganizationsStore(config.databaseUrl),
        },
        {
          inject: [AUTH_SERVICE, ORGANIZATIONS_STORE],
          provide: ORGANIZATIONS_SERVICE,
          useFactory: (auth: AuthService, store: PgOrganizationsStore) =>
            new OrganizationsService(auth, store),
        },
        {
          provide: VENUES_STORE,
          useFactory: () => new PgVenuesStore(config.databaseUrl),
        },
        {
          inject: [AUTH_SERVICE, VENUES_STORE],
          provide: VENUES_SERVICE,
          useFactory: (auth: AuthService, store: PgVenuesStore) =>
            new VenuesService(auth, store),
        },
        {
          provide: DISCOVERY_STORE,
          useFactory: () => new PgDiscoveryStore(config.databaseUrl),
        },
        {
          inject: [DISCOVERY_STORE],
          provide: DISCOVERY_SERVICE,
          useFactory: (store: PgDiscoveryStore) => new DiscoveryService(store),
        },
        {
          provide: EVENTS_STORE,
          useFactory: () => new PgEventsStore(config.databaseUrl),
        },
        {
          inject: [AUTH_SERVICE, EVENTS_STORE],
          provide: EVENTS_SERVICE,
          useFactory: (auth: AuthService, store: PgEventsStore) =>
            new EventsService(auth, store),
        },
        {
          provide: HOLD_EXPIRY_MIRROR,
          useFactory: () =>
            new RedisHoldExpiryMirror(
              config.redisUrl,
              config.dependencyTimeoutMs,
              logger
            ),
        },
        {
          inject: [HOLD_EXPIRY_MIRROR],
          provide: HOLDS_STORE,
          useFactory: (mirror: RedisHoldExpiryMirror) =>
            new PgHoldsStore(config.databaseUrl, mirror),
        },
        {
          inject: [AUTH_SERVICE, HOLDS_STORE],
          provide: HOLDS_SERVICE,
          useFactory: (auth: AuthService, store: PgHoldsStore) =>
            new HoldsService(auth, store),
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
