import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { loadApiConfig } from "@event-ticketing/config";

import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
}

void bootstrap().catch(() => {
  Logger.error("API startup failed.");
  process.exitCode = 1;
});
