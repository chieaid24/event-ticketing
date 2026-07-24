import { z } from "zod";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";

const databaseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "postgresql:" || protocol === "postgres:";
  });

const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "redis:" || protocol === "rediss:";
  });

const logLevelSchema = z
  .enum(["trace", "debug", "info", "warn", "error", "fatal"])
  .default("info");

const apiConfigSchema = z.object({
  databaseUrl: databaseUrlSchema.default(localDatabaseUrl),
  dependencyTimeoutMs: z.coerce
    .number()
    .int()
    .min(100)
    .max(10_000)
    .default(2_000),
  host: z.string().min(1).default("127.0.0.1"),
  logLevel: logLevelSchema,
  port: z.coerce.number().int().min(1).max(65_535).default(4000),
  redisUrl: redisUrlSchema.default("redis://127.0.0.1:6379"),
});

const webConfigSchema = z.object({
  apiBaseUrl: z
    .string()
    .url()
    .default("http://127.0.0.1:4000")
    .transform((url) => url.replace(/\/$/, "")),
});

const workerConfigSchema = z
  .object({
    databaseUrl: databaseUrlSchema.default(localDatabaseUrl),
    logLevel: logLevelSchema,
    outboxBatchSize: z.coerce.number().int().min(1).max(100).default(10),
    outboxLeaseMs: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(30_000),
    outboxPollIntervalMs: z.coerce
      .number()
      .int()
      .min(50)
      .max(60_000)
      .default(1_000),
    outboxRetryBaseMs: z.coerce
      .number()
      .int()
      .min(100)
      .max(3_600_000)
      .default(1_000),
    outboxRetryMaximumMs: z.coerce
      .number()
      .int()
      .min(100)
      .max(86_400_000)
      .default(300_000),
    redisUrl: redisUrlSchema.default("redis://127.0.0.1:6379"),
    shutdownTimeoutMs: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(10_000),
  })
  .refine((config) => config.outboxRetryMaximumMs >= config.outboxRetryBaseMs, {
    message: "must be greater than or equal to the retry base",
    path: ["outboxRetryMaximumMs"],
  });

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WebConfig = z.infer<typeof webConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export class ConfigurationError extends Error {
  readonly application: "api" | "web" | "worker";
  readonly variables: readonly string[];

  constructor(
    application: ConfigurationError["application"],
    variables: readonly string[]
  ) {
    super(
      `Invalid ${application} configuration: ${variables.join(", ") || "unknown variable"}`
    );
    this.name = "ConfigurationError";
    this.application = application;
    this.variables = variables;
  }
}

function parseConfig<T>(
  application: ConfigurationError["application"],
  schema: z.ZodType<T>,
  values: unknown,
  variableNames: Readonly<Record<string, string>>
): T {
  const result = schema.safeParse(values);

  if (result.success) {
    return result.data;
  }

  const variables = [
    ...new Set(
      result.error.issues.map((issue) => {
        const field = String(issue.path[0] ?? "");
        return variableNames[field] ?? field;
      })
    ),
  ].sort();
  throw new ConfigurationError(application, variables);
}

export function loadApiConfig(
  environment: NodeJS.ProcessEnv = process.env
): ApiConfig {
  return parseConfig(
    "api",
    apiConfigSchema,
    {
      databaseUrl: environment["DATABASE_URL"],
      dependencyTimeoutMs: environment["API_DEPENDENCY_TIMEOUT_MS"],
      host: environment["API_HOST"],
      logLevel: environment["LOG_LEVEL"],
      port: environment["API_PORT"],
      redisUrl: environment["REDIS_URL"],
    },
    {
      databaseUrl: "DATABASE_URL",
      dependencyTimeoutMs: "API_DEPENDENCY_TIMEOUT_MS",
      host: "API_HOST",
      logLevel: "LOG_LEVEL",
      port: "API_PORT",
      redisUrl: "REDIS_URL",
    }
  );
}

export function loadWebConfig(
  environment: NodeJS.ProcessEnv = process.env
): WebConfig {
  return parseConfig(
    "web",
    webConfigSchema,
    {
      apiBaseUrl: environment["API_BASE_URL"],
    },
    {
      apiBaseUrl: "API_BASE_URL",
    }
  );
}

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env
): WorkerConfig {
  return parseConfig(
    "worker",
    workerConfigSchema,
    {
      databaseUrl: environment["DATABASE_URL"],
      logLevel: environment["LOG_LEVEL"],
      outboxBatchSize: environment["WORKER_OUTBOX_BATCH_SIZE"],
      outboxLeaseMs: environment["WORKER_OUTBOX_LEASE_MS"],
      outboxPollIntervalMs: environment["WORKER_OUTBOX_POLL_INTERVAL_MS"],
      outboxRetryBaseMs: environment["WORKER_OUTBOX_RETRY_BASE_MS"],
      outboxRetryMaximumMs: environment["WORKER_OUTBOX_RETRY_MAXIMUM_MS"],
      redisUrl: environment["REDIS_URL"],
      shutdownTimeoutMs: environment["WORKER_SHUTDOWN_TIMEOUT_MS"],
    },
    {
      databaseUrl: "DATABASE_URL",
      logLevel: "LOG_LEVEL",
      outboxBatchSize: "WORKER_OUTBOX_BATCH_SIZE",
      outboxLeaseMs: "WORKER_OUTBOX_LEASE_MS",
      outboxPollIntervalMs: "WORKER_OUTBOX_POLL_INTERVAL_MS",
      outboxRetryBaseMs: "WORKER_OUTBOX_RETRY_BASE_MS",
      outboxRetryMaximumMs: "WORKER_OUTBOX_RETRY_MAXIMUM_MS",
      redisUrl: "REDIS_URL",
      shutdownTimeoutMs: "WORKER_SHUTDOWN_TIMEOUT_MS",
    }
  );
}
