import {
  createAuthToken,
  findUserById,
  generateAuthSecret,
  hashAuthSecret,
  invalidateAuthTokens,
  type AuthTokenPurpose,
  type DatabaseExecutor,
  type OutboxEvent,
} from "@event-ticketing/database";

import type { AuthEmailer } from "./mailer.js";
import { OutboxHandlerError, type OutboxHandler } from "./outbox-processor.js";

export const EMAIL_VERIFICATION_REQUESTED_TOPIC =
  "auth.email.verification.requested";
export const PASSWORD_RESET_REQUESTED_TOPIC = "auth.password.reset.requested";

export interface AuthEmailHandlerDependencies {
  emailer: AuthEmailer;
  executor: DatabaseExecutor;
  resetTokenTtlSeconds: number;
  verificationTokenTtlSeconds: number;
  webBaseUrl: string;
}

function requireUserId(event: OutboxEvent): string {
  if (
    typeof event.payload !== "object" ||
    event.payload === null ||
    !("userId" in event.payload) ||
    typeof event.payload.userId !== "string" ||
    event.payload.userId !== event.aggregateId
  ) {
    throw new OutboxHandlerError("invalid_event_payload");
  }
  return event.payload.userId;
}

// The worker mints tokens so the plaintext secret never sits in the outbox
// payload or any log; only its hash reaches the database.
async function issueToken(
  dependencies: AuthEmailHandlerDependencies,
  input: { purpose: AuthTokenPurpose; ttlSeconds: number; userId: string }
): Promise<string> {
  await invalidateAuthTokens(dependencies.executor, {
    purpose: input.purpose,
    userId: input.userId,
  });
  const secret = generateAuthSecret();
  await createAuthToken(dependencies.executor, {
    expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    purpose: input.purpose,
    tokenHash: hashAuthSecret(secret),
    userId: input.userId,
  });
  return secret;
}

async function sendOrFail(
  emailer: AuthEmailer,
  message: { subject: string; text: string; to: string }
): Promise<void> {
  try {
    await emailer.send(message);
  } catch {
    throw new OutboxHandlerError("email_send_failed");
  }
}

export function createAuthEmailHandlers(
  dependencies: AuthEmailHandlerDependencies
): Readonly<Record<string, OutboxHandler>> {
  const verificationHandler: OutboxHandler = async (event) => {
    const userId = requireUserId(event);
    const user = await findUserById(dependencies.executor, userId);
    if (!user || user.emailVerifiedAt !== null) {
      return;
    }

    const secret = await issueToken(dependencies, {
      purpose: "email_verification",
      ttlSeconds: dependencies.verificationTokenTtlSeconds,
      userId,
    });
    const hours = Math.round(dependencies.verificationTokenTtlSeconds / 3600);
    await sendOrFail(dependencies.emailer, {
      subject: "Verify your email address",
      text: [
        "Confirm your email address to activate your account:",
        "",
        `${dependencies.webBaseUrl}/verify-email?token=${secret}`,
        "",
        `The link expires in ${String(hours)} hours and works once.`,
        "If you did not create this account, ignore this email.",
      ].join("\n"),
      to: user.email,
    });
  };

  const passwordResetHandler: OutboxHandler = async (event) => {
    const userId = requireUserId(event);
    const user = await findUserById(dependencies.executor, userId);
    if (!user || user.status !== "active") {
      return;
    }

    const secret = await issueToken(dependencies, {
      purpose: "password_reset",
      ttlSeconds: dependencies.resetTokenTtlSeconds,
      userId,
    });
    const minutes = Math.round(dependencies.resetTokenTtlSeconds / 60);
    await sendOrFail(dependencies.emailer, {
      subject: "Reset your password",
      text: [
        "Choose a new password using this link:",
        "",
        `${dependencies.webBaseUrl}/reset-password?token=${secret}`,
        "",
        `The link expires in ${String(minutes)} minutes and works once.`,
        "If you did not request this, ignore this email.",
      ].join("\n"),
      to: user.email,
    });
  };

  return {
    [EMAIL_VERIFICATION_REQUESTED_TOPIC]: verificationHandler,
    [PASSWORD_RESET_REQUESTED_TOPIC]: passwordResetHandler,
  };
}
