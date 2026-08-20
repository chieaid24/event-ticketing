import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import pino from "pino";

import { loadApiConfig } from "@event-ticketing/config";

import { AppModule } from "./app.module.js";
import { UnhandledExceptionFilter } from "./unhandled-exception.filter.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const logger = pino({
    base: {
      service: "api",
    },
    level: config.logLevel,
  });
  const app = await NestFactory.create(AppModule.register(config, logger), {
    logger: false,
    // webhook sigs verify against exact bytes provider sent
    rawBody: true,
  });

  app.enableCors({
    allowedHeaders: [
      "content-type",
      "idempotency-key",
      "x-csrf-token",
      "x-request-id",
      "x-trace-id",
      "traceparent",
      "x-waiting-room-token",
    ],
    credentials: true,
    exposedHeaders: ["x-request-id", "x-trace-id"],
    maxAge: 600,
    methods: ["GET", "PATCH", "POST", "PUT", "DELETE"],
    origin: [...config.trustedOrigins],
  });
  app.useGlobalFilters(new UnhandledExceptionFilter(logger));
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  logger.info({
    event: "api.started",
    port: config.port,
  });
}

void bootstrap().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      event: "api.startup.failed",
      service: "api",
    })}\n`
  );
  process.exitCode = 1;
});
