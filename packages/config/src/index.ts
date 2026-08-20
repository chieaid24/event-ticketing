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

const booleanFlagSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

const smtpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "smtp:" || protocol === "smtps:";
  });

const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  )
  .pipe(z.array(z.string().url()).min(1))
  .transform((origins) => origins.map((origin) => new URL(origin).origin));

const paymentProviderSchema = z.enum(["stripe", "fake"]).default("fake");

// Publicly known local defaults; production refuses them (see loadApiConfig).
const developmentPaymentWebhookSecret = "whsec_local_development_only";
const developmentWaitingRoomTokenSecret =
  "local-waiting-room-secret-only-32-bytes";

// The default only signs local fake-provider deliveries; a real Stripe
// endpoint secret always arrives via PAYMENT_WEBHOOK_SECRET.
const paymentWebhookSecretSchema = z
  .string()
  .min(8)
  .max(200)
  .default(developmentPaymentWebhookSecret);

function requireStripeCredentials(config: {
  paymentProvider: "stripe" | "fake";
  stripeSecretKey?: string | undefined;
}): boolean {
  return (
    config.paymentProvider !== "stripe" ||
    (config.stripeSecretKey ?? "").length > 0
  );
}

const apiConfigSchema = z
  .object({
    cookieSecure: booleanFlagSchema.default(false),
    databaseUrl: databaseUrlSchema.default(localDatabaseUrl),
    dependencyTimeoutMs: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .default(2_000),
    // Absent locally: Front Door origin verification only runs when deployed.
    frontDoorProfileId: z.string().min(1).max(200).optional(),
    host: z.string().min(1).default("127.0.0.1"),
    logLevel: logLevelSchema,
    paymentProvider: paymentProviderSchema,
    paymentWebhookSecret: paymentWebhookSecretSchema,
    port: z.coerce.number().int().min(1).max(65_535).default(4000),
    redisUrl: redisUrlSchema.default("redis://127.0.0.1:6379"),
    sessionAbsoluteTtlSeconds: z.coerce
      .number()
      .int()
      .min(3_600)
      .max(31_536_000)
      .default(2_592_000),
    sessionIdleTtlSeconds: z.coerce
      .number()
      .int()
      .min(300)
      .max(604_800)
      .default(86_400),
    stripePublishableKey: z.string().min(1).max(200).optional(),
    stripeSecretKey: z.string().min(1).max(200).optional(),
    trustedOrigins: originListSchema.prefault(
      "http://127.0.0.1:3000,http://localhost:3000"
    ),
    waitingRoomAdmissionCapacity: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(100),
    waitingRoomHeartbeatTtlSeconds: z.coerce
      .number()
      .int()
      .min(10)
      .max(600)
      .default(60),
    waitingRoomLeaseTtlSeconds: z.coerce
      .number()
      .int()
      .min(30)
      .max(3_600)
      .default(300),
    waitingRoomTokenSecret: z
      .string()
      .min(32)
      .max(200)
      .default(developmentWaitingRoomTokenSecret),
    waitingRoomTokenTtlSeconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(1_800),
  })
  .refine(
    (config) =>
      config.sessionAbsoluteTtlSeconds >= config.sessionIdleTtlSeconds,
    {
      message: "must be greater than or equal to the idle session TTL",
      path: ["sessionAbsoluteTtlSeconds"],
    }
  )
  .refine(requireStripeCredentials, {
    message: "is required when PAYMENT_PROVIDER is stripe",
    path: ["stripeSecretKey"],
  })
  .refine(
    (config) =>
      config.paymentProvider !== "stripe" ||
      (config.stripePublishableKey ?? "").length > 0,
    {
      message: "is required when PAYMENT_PROVIDER is stripe",
      path: ["stripePublishableKey"],
    }
  );

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
    mailFrom: z
      .string()
      .min(3)
      .max(320)
      .default("Event Ticketing <no-reply@example.test>"),
    opsAlertEmail: z.string().min(3).max(320).default("ops@example.test"),
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
    paymentProvider: paymentProviderSchema,
    redisUrl: redisUrlSchema.default("redis://127.0.0.1:6379"),
    resetTokenTtlSeconds: z.coerce
      .number()
      .int()
      .min(300)
      .max(86_400)
      .default(1_800),
    shutdownTimeoutMs: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(10_000),
    smtpUrl: smtpUrlSchema.default("smtp://127.0.0.1:1025"),
    stripeSecretKey: z.string().min(1).max(200).optional(),
    verificationTokenTtlSeconds: z.coerce
      .number()
      .int()
      .min(300)
      .max(604_800)
      .default(86_400),
    webBaseUrl: z
      .string()
      .url()
      .default("http://127.0.0.1:3000")
      .transform((url) => url.replace(/\/$/, "")),
  })
  .refine((config) => config.outboxRetryMaximumMs >= config.outboxRetryBaseMs, {
    message: "must be greater than or equal to the retry base",
    path: ["outboxRetryMaximumMs"],
  })
  .refine(requireStripeCredentials, {
    message: "is required when PAYMENT_PROVIDER is stripe",
    path: ["stripeSecretKey"],
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

// Fails closed in production: these secrets must be set explicitly and must
// not reuse the publicly known development defaults.
const productionRequiredApiSecrets: Readonly<Record<string, string>> = {
  PAYMENT_WEBHOOK_SECRET: developmentPaymentWebhookSecret,
  WAITING_ROOM_TOKEN_SECRET: developmentWaitingRoomTokenSecret,
};

function assertProductionApiSecrets(environment: NodeJS.ProcessEnv): void {
  if (environment["NODE_ENV"] !== "production") {
    return;
  }

  const variables = Object.entries(productionRequiredApiSecrets)
    .filter(([name, developmentDefault]) => {
      const value = environment[name];
      return !value || value === developmentDefault;
    })
    .map(([name]) => name)
    .sort();

  if (variables.length > 0) {
    throw new ConfigurationError("api", variables);
  }
}

export function loadApiConfig(
  environment: NodeJS.ProcessEnv = process.env
): ApiConfig {
  assertProductionApiSecrets(environment);
  return parseConfig(
    "api",
    apiConfigSchema,
    {
      cookieSecure: environment["API_COOKIE_SECURE"],
      databaseUrl: environment["DATABASE_URL"],
      dependencyTimeoutMs: environment["API_DEPENDENCY_TIMEOUT_MS"],
      frontDoorProfileId: environment["API_FRONT_DOOR_PROFILE_ID"],
      host: environment["API_HOST"],
      logLevel: environment["LOG_LEVEL"],
      paymentProvider: environment["PAYMENT_PROVIDER"],
      paymentWebhookSecret: environment["PAYMENT_WEBHOOK_SECRET"],
      port: environment["API_PORT"],
      redisUrl: environment["REDIS_URL"],
      sessionAbsoluteTtlSeconds: environment["SESSION_ABSOLUTE_TTL_SECONDS"],
      sessionIdleTtlSeconds: environment["SESSION_IDLE_TTL_SECONDS"],
      stripePublishableKey: environment["STRIPE_PUBLISHABLE_KEY"],
      stripeSecretKey: environment["STRIPE_SECRET_KEY"],
      trustedOrigins: environment["API_TRUSTED_ORIGINS"],
      waitingRoomAdmissionCapacity:
        environment["WAITING_ROOM_ADMISSION_CAPACITY"],
      waitingRoomHeartbeatTtlSeconds:
        environment["WAITING_ROOM_HEARTBEAT_TTL_SECONDS"],
      waitingRoomLeaseTtlSeconds: environment["WAITING_ROOM_LEASE_TTL_SECONDS"],
      waitingRoomTokenSecret: environment["WAITING_ROOM_TOKEN_SECRET"],
      waitingRoomTokenTtlSeconds: environment["WAITING_ROOM_TOKEN_TTL_SECONDS"],
    },
    {
      cookieSecure: "API_COOKIE_SECURE",
      databaseUrl: "DATABASE_URL",
      dependencyTimeoutMs: "API_DEPENDENCY_TIMEOUT_MS",
      frontDoorProfileId: "API_FRONT_DOOR_PROFILE_ID",
      host: "API_HOST",
      logLevel: "LOG_LEVEL",
      paymentProvider: "PAYMENT_PROVIDER",
      paymentWebhookSecret: "PAYMENT_WEBHOOK_SECRET",
      port: "API_PORT",
      redisUrl: "REDIS_URL",
      sessionAbsoluteTtlSeconds: "SESSION_ABSOLUTE_TTL_SECONDS",
      sessionIdleTtlSeconds: "SESSION_IDLE_TTL_SECONDS",
      stripePublishableKey: "STRIPE_PUBLISHABLE_KEY",
      stripeSecretKey: "STRIPE_SECRET_KEY",
      trustedOrigins: "API_TRUSTED_ORIGINS",
      waitingRoomAdmissionCapacity: "WAITING_ROOM_ADMISSION_CAPACITY",
      waitingRoomHeartbeatTtlSeconds: "WAITING_ROOM_HEARTBEAT_TTL_SECONDS",
      waitingRoomLeaseTtlSeconds: "WAITING_ROOM_LEASE_TTL_SECONDS",
      waitingRoomTokenSecret: "WAITING_ROOM_TOKEN_SECRET",
      waitingRoomTokenTtlSeconds: "WAITING_ROOM_TOKEN_TTL_SECONDS",
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
      mailFrom: environment["MAIL_FROM"],
      opsAlertEmail: environment["OPS_ALERT_EMAIL"],
      outboxBatchSize: environment["WORKER_OUTBOX_BATCH_SIZE"],
      outboxLeaseMs: environment["WORKER_OUTBOX_LEASE_MS"],
      outboxPollIntervalMs: environment["WORKER_OUTBOX_POLL_INTERVAL_MS"],
      outboxRetryBaseMs: environment["WORKER_OUTBOX_RETRY_BASE_MS"],
      outboxRetryMaximumMs: environment["WORKER_OUTBOX_RETRY_MAXIMUM_MS"],
      paymentProvider: environment["PAYMENT_PROVIDER"],
      redisUrl: environment["REDIS_URL"],
      resetTokenTtlSeconds: environment["RESET_TOKEN_TTL_SECONDS"],
      shutdownTimeoutMs: environment["WORKER_SHUTDOWN_TIMEOUT_MS"],
      smtpUrl: environment["SMTP_URL"],
      stripeSecretKey: environment["STRIPE_SECRET_KEY"],
      verificationTokenTtlSeconds:
        environment["VERIFICATION_TOKEN_TTL_SECONDS"],
      webBaseUrl: environment["WEB_BASE_URL"],
    },
    {
      databaseUrl: "DATABASE_URL",
      logLevel: "LOG_LEVEL",
      mailFrom: "MAIL_FROM",
      opsAlertEmail: "OPS_ALERT_EMAIL",
      outboxBatchSize: "WORKER_OUTBOX_BATCH_SIZE",
      outboxLeaseMs: "WORKER_OUTBOX_LEASE_MS",
      outboxPollIntervalMs: "WORKER_OUTBOX_POLL_INTERVAL_MS",
      outboxRetryBaseMs: "WORKER_OUTBOX_RETRY_BASE_MS",
      outboxRetryMaximumMs: "WORKER_OUTBOX_RETRY_MAXIMUM_MS",
      paymentProvider: "PAYMENT_PROVIDER",
      redisUrl: "REDIS_URL",
      resetTokenTtlSeconds: "RESET_TOKEN_TTL_SECONDS",
      shutdownTimeoutMs: "WORKER_SHUTDOWN_TIMEOUT_MS",
      smtpUrl: "SMTP_URL",
      stripeSecretKey: "STRIPE_SECRET_KEY",
      verificationTokenTtlSeconds: "VERIFICATION_TOKEN_TTL_SECONDS",
      webBaseUrl: "WEB_BASE_URL",
    }
  );
}
