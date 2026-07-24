import { z } from "zod";

const apiConfigSchema = z.object({
  host: z.string().min(1).default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65_535).default(4000),
});

const webConfigSchema = z.object({
  apiBaseUrl: z
    .string()
    .url()
    .default("http://127.0.0.1:4000")
    .transform((url) => url.replace(/\/$/, "")),
});

const workerConfigSchema = z.object({
  shutdownTimeoutMs: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(10_000),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WebConfig = z.infer<typeof webConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadApiConfig(
  environment: NodeJS.ProcessEnv = process.env
): ApiConfig {
  return apiConfigSchema.parse({
    host: environment["API_HOST"],
    port: environment["API_PORT"],
  });
}

export function loadWebConfig(
  environment: NodeJS.ProcessEnv = process.env
): WebConfig {
  return webConfigSchema.parse({
    apiBaseUrl: environment["API_BASE_URL"],
  });
}

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env
): WorkerConfig {
  return workerConfigSchema.parse({
    shutdownTimeoutMs: environment["WORKER_SHUTDOWN_TIMEOUT_MS"],
  });
}
