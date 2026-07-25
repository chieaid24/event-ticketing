import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import pino from "pino";

import { loadApiConfig } from "@event-ticketing/config";

import { AppModule } from "./app.module.js";

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
  });

  app.enableCors({
    allowedHeaders: ["content-type", "x-csrf-token", "x-request-id"],
    credentials: true,
    exposedHeaders: ["x-request-id"],
    maxAge: 600,
    methods: ["GET", "PATCH", "POST", "DELETE"],
    origin: [...config.trustedOrigins],
  });
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
