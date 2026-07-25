import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import {
  hashAuthSecret,
  type DatabaseExecutor,
  type OutboxEvent,
} from "@event-ticketing/database";

import {
  createAuthEmailHandlers,
  EMAIL_VERIFICATION_REQUESTED_TOPIC,
  PASSWORD_RESET_REQUESTED_TOPIC,
} from "./auth-email-handlers.js";
import type { AuthEmailMessage } from "./mailer.js";
import { OutboxHandlerError } from "./outbox-processor.js";

interface FakeUser extends QueryResultRow {
  email: string;
  emailVerifiedAt: Date | null;
  id: string;
  status: string;
}

interface RecordedQuery {
  text: string;
  values: unknown[];
}

function createExecutor(user: FakeUser | null): {
  executor: DatabaseExecutor;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const executor: DatabaseExecutor = {
    async query<Row extends QueryResultRow>(
      text: string,
      values: unknown[] = []
    ): Promise<QueryResult<Row>> {
      queries.push({ text, values });
      const respond = (rows: Row[]): QueryResult<Row> => ({
        command: "",
        fields: [],
        oid: 0,
        rowCount: rows.length,
        rows,
      });

      if (text.includes('FROM "users"')) {
        return respond(user ? [user as unknown as Row] : []);
      }
      if (text.includes('UPDATE "auth_tokens"')) {
        return respond([]);
      }
      if (text.includes('INSERT INTO "auth_tokens"')) {
        const row = {
          consumedAt: null,
          expiresAt: values[3],
          id: randomUUID(),
          purpose: values[1],
          userId: values[0],
        };
        return respond([row as unknown as Row]);
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  return { executor, queries };
}

function createEmailer(options: { fail?: boolean } = {}): {
  emailer: { send(message: AuthEmailMessage): Promise<void> };
  sent: AuthEmailMessage[];
} {
  const sent: AuthEmailMessage[] = [];
  return {
    emailer: {
      async send(message: AuthEmailMessage): Promise<void> {
        if (options.fail) {
          throw new Error("SMTP host unreachable at 10.0.0.5");
        }
        sent.push(message);
      },
    },
    sent,
  };
}

function makeEvent(topic: string, userId: string): OutboxEvent {
  return {
    aggregateId: userId,
    aggregateType: "user",
    attemptCount: 0,
    availableAt: new Date(),
    id: randomUUID(),
    maxAttempts: 5,
    payload: { userId },
    topic,
  };
}

function makeHandlers(input: {
  emailer: { send(message: AuthEmailMessage): Promise<void> };
  executor: DatabaseExecutor;
}) {
  return createAuthEmailHandlers({
    emailer: input.emailer,
    executor: input.executor,
    resetTokenTtlSeconds: 1_800,
    verificationTokenTtlSeconds: 86_400,
    webBaseUrl: "http://127.0.0.1:3000",
  });
}

function contextFor(event: OutboxEvent) {
  return { eventId: event.id, idempotencyKey: event.id };
}

describe("verification email handler", () => {
  it("stores only the token hash and mails the plaintext link", async () => {
    const userId = randomUUID();
    const { executor, queries } = createExecutor({
      email: "pending@example.test",
      emailVerifiedAt: null,
      id: userId,
      status: "pending",
    });
    const { emailer, sent } = createEmailer();
    const handlers = makeHandlers({ emailer, executor });
    const event = makeEvent(EMAIL_VERIFICATION_REQUESTED_TOPIC, userId);

    await handlers[EMAIL_VERIFICATION_REQUESTED_TOPIC]?.(
      event,
      contextFor(event)
    );

    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message?.to).toBe("pending@example.test");
    const match = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(
      message?.text ?? ""
    );
    expect(match).not.toBeNull();

    const insert = queries.find((query) =>
      query.text.includes('INSERT INTO "auth_tokens"')
    );
    expect(insert?.values[1]).toBe("email_verification");
    expect(insert?.values[2]).toBe(hashAuthSecret(match?.[1] ?? ""));
    expect(message?.text).not.toContain(String(insert?.values[2]));
  });

  it("skips users who are already verified", async () => {
    const userId = randomUUID();
    const { executor, queries } = createExecutor({
      email: "active@example.test",
      emailVerifiedAt: new Date(),
      id: userId,
      status: "active",
    });
    const { emailer, sent } = createEmailer();
    const handlers = makeHandlers({ emailer, executor });
    const event = makeEvent(EMAIL_VERIFICATION_REQUESTED_TOPIC, userId);

    await handlers[EMAIL_VERIFICATION_REQUESTED_TOPIC]?.(
      event,
      contextFor(event)
    );

    expect(sent).toHaveLength(0);
    expect(
      queries.some((query) => query.text.includes('INSERT INTO "auth_tokens"'))
    ).toBe(false);
  });

  it("rejects a payload that does not match the aggregate", async () => {
    const { executor } = createExecutor(null);
    const { emailer } = createEmailer();
    const handlers = makeHandlers({ emailer, executor });
    const event = {
      ...makeEvent(EMAIL_VERIFICATION_REQUESTED_TOPIC, randomUUID()),
      payload: { userId: randomUUID() },
    };

    await expect(
      handlers[EMAIL_VERIFICATION_REQUESTED_TOPIC]?.(event, contextFor(event))
    ).rejects.toMatchObject({ code: "invalid_event_payload" });
  });

  it("maps provider failures to a sanitized error code", async () => {
    const userId = randomUUID();
    const { executor } = createExecutor({
      email: "pending@example.test",
      emailVerifiedAt: null,
      id: userId,
      status: "pending",
    });
    const { emailer } = createEmailer({ fail: true });
    const handlers = makeHandlers({ emailer, executor });
    const event = makeEvent(EMAIL_VERIFICATION_REQUESTED_TOPIC, userId);

    const failure = handlers[EMAIL_VERIFICATION_REQUESTED_TOPIC]?.(
      event,
      contextFor(event)
    );
    await expect(failure).rejects.toBeInstanceOf(OutboxHandlerError);
    await expect(failure).rejects.toMatchObject({
      code: "email_send_failed",
    });
    await expect(failure).rejects.not.toMatchObject({
      message: expect.stringContaining("10.0.0.5") as unknown,
    });
  });
});

describe("password reset email handler", () => {
  it("mails a single-use reset link to active users", async () => {
    const userId = randomUUID();
    const { executor, queries } = createExecutor({
      email: "active@example.test",
      emailVerifiedAt: new Date(),
      id: userId,
      status: "active",
    });
    const { emailer, sent } = createEmailer();
    const handlers = makeHandlers({ emailer, executor });
    const event = makeEvent(PASSWORD_RESET_REQUESTED_TOPIC, userId);

    await handlers[PASSWORD_RESET_REQUESTED_TOPIC]?.(event, contextFor(event));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("/reset-password?token=");
    expect(sent[0]?.text).toContain("30 minutes");
    const insert = queries.find((query) =>
      query.text.includes('INSERT INTO "auth_tokens"')
    );
    expect(insert?.values[1]).toBe("password_reset");
  });

  it("skips users who are not active", async () => {
    const userId = randomUUID();
    const { executor } = createExecutor({
      email: "pending@example.test",
      emailVerifiedAt: null,
      id: userId,
      status: "pending",
    });
    const { emailer, sent } = createEmailer();
    const handlers = makeHandlers({ emailer, executor });
    const event = makeEvent(PASSWORD_RESET_REQUESTED_TOPIC, userId);

    await handlers[PASSWORD_RESET_REQUESTED_TOPIC]?.(event, contextFor(event));

    expect(sent).toHaveLength(0);
  });
});
