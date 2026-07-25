import { timingSafeEqual } from "node:crypto";

import { HttpException } from "@nestjs/common";
import type { output, ZodType } from "zod";

import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  type AcceptedResponse,
  type AuthUser,
  type ChangePasswordResponse,
  type MeResponse,
  type ResetPasswordResponse,
  type SessionListResponse,
  type VerifyEmailResponse,
} from "@event-ticketing/contracts";
import {
  generateAuthSecret,
  hashAuthSecret,
  type AuthUserRow,
  type SessionRow,
} from "@event-ticketing/database";

import type { SessionSecrets } from "./cookies.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import type { AuthStore } from "./auth.store.js";

const secretPattern = /^[A-Za-z0-9_-]{20,128}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AuthServiceOptions {
  sessionAbsoluteTtlSeconds: number;
  sessionIdleTtlSeconds: number;
  trustedOrigins: readonly string[];
}

export interface RequestAuthContext {
  csrfToken: string | undefined;
  origin: string | undefined;
  sessionSecret: string | undefined;
}

export interface AuthenticatedSession {
  session: SessionRow;
  user: AuthUserRow;
}

function authError(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

function parseRequest<S extends ZodType>(schema: S, input: unknown): output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") ?? "";
    authError(
      400,
      "invalid_request",
      path ? `The field "${path}" is invalid.` : "The request body is invalid."
    );
  }
  return parsed.data;
}

function toAuthUser(user: AuthUserRow): AuthUser {
  return {
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt
      ? user.emailVerifiedAt.toISOString()
      : null,
    id: user.id,
    platformRole: user.platformRole,
    status: user.status,
  };
}

function hashesMatch(candidateHash: string, storedHash: string): boolean {
  const candidate = Buffer.from(candidateHash, "hex");
  const stored = Buffer.from(storedHash, "hex");
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly options: AuthServiceOptions
  ) {}

  async register(input: unknown): Promise<AcceptedResponse> {
    const request = parseRequest(registerRequestSchema, input);
    const passwordHash = await hashPassword(request.password);
    await this.store.register({ email: request.email, passwordHash });
    return { status: "accepted" };
  }

  async verifyEmail(input: unknown): Promise<VerifyEmailResponse> {
    const request = parseRequest(verifyEmailRequestSchema, input);
    const verified = await this.store.verifyEmail(
      hashAuthSecret(request.token)
    );
    if (!verified) {
      authError(
        400,
        "invalid_token",
        "The verification link is invalid or has expired."
      );
    }
    return { status: "verified" };
  }

  async login(
    input: unknown,
    deviceSummary: string
  ): Promise<{ secrets: SessionSecrets; user: AuthUser }> {
    const request = parseRequest(loginRequestSchema, input);
    const user = await this.store.findUserByEmail(request.email);
    const passwordValid = await verifyPassword(
      user?.passwordHash ?? null,
      request.password
    );
    if (!user || !passwordValid) {
      authError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    if (user.status === "pending") {
      authError(
        403,
        "email_not_verified",
        "Verify your email address before signing in."
      );
    }
    if (user.status !== "active") {
      authError(403, "account_unavailable", "This account is unavailable.");
    }

    const secrets = await this.createSessionSecrets(user.id, deviceSummary);
    return { secrets, user: toAuthUser(user) };
  }

  async me(context: RequestAuthContext): Promise<MeResponse> {
    const { user } = await this.requireSession(context);
    return { user: toAuthUser(user) };
  }

  async logout(context: RequestAuthContext): Promise<AcceptedResponse> {
    const authenticated = await this.resolveSession(context.sessionSecret);
    if (authenticated) {
      this.requireCsrf(context, authenticated.session);
      await this.store.revokeSession({
        sessionId: authenticated.session.id,
        userId: authenticated.session.userId,
      });
    }
    return { status: "accepted" };
  }

  async forgotPassword(input: unknown): Promise<AcceptedResponse> {
    const request = parseRequest(forgotPasswordRequestSchema, input);
    await this.store.requestPasswordReset(request.email);
    return { status: "accepted" };
  }

  async resetPassword(input: unknown): Promise<ResetPasswordResponse> {
    const request = parseRequest(resetPasswordRequestSchema, input);
    const passwordHash = await hashPassword(request.password);
    const reset = await this.store.resetPassword({
      passwordHash,
      tokenHash: hashAuthSecret(request.token),
    });
    if (!reset) {
      authError(
        400,
        "invalid_token",
        "The password reset link is invalid or has expired."
      );
    }
    return { status: "password_reset" };
  }

  async changePassword(
    context: RequestAuthContext,
    input: unknown,
    deviceSummary: string
  ): Promise<{ response: ChangePasswordResponse; secrets: SessionSecrets }> {
    const { session, user } = await this.requireSession(context);
    this.requireCsrf(context, session);
    const request = parseRequest(changePasswordRequestSchema, input);
    const currentValid = await verifyPassword(
      user.passwordHash,
      request.currentPassword
    );
    if (!currentValid) {
      authError(403, "invalid_credentials", "The current password is wrong.");
    }

    const passwordHash = await hashPassword(request.newPassword);
    const sessionSecret = generateAuthSecret();
    const csrfSecret = generateAuthSecret();
    // Every session is revoked and the caller gets a freshly rotated one.
    await this.store.changePassword({
      passwordHash,
      session: {
        absoluteExpiresAt: this.absoluteExpiry(),
        csrfTokenHash: hashAuthSecret(csrfSecret),
        deviceSummary,
        tokenHash: hashAuthSecret(sessionSecret),
        userId: user.id,
      },
    });
    return {
      response: { status: "password_changed" },
      secrets: { csrfSecret, sessionSecret },
    };
  }

  async listSessions(
    context: RequestAuthContext
  ): Promise<SessionListResponse> {
    const { session } = await this.requireSession(context);
    const sessions = await this.store.listActiveSessions({
      idleCutoff: this.idleCutoff(),
      userId: session.userId,
    });
    return {
      sessions: sessions.map((row) => ({
        createdAt: row.createdAt.toISOString(),
        current: row.id === session.id,
        deviceSummary: row.deviceSummary.trim(),
        id: row.id,
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
    };
  }

  async revokeSession(
    context: RequestAuthContext,
    sessionId: string
  ): Promise<{ currentRevoked: boolean; response: AcceptedResponse }> {
    const { session } = await this.requireSession(context);
    this.requireCsrf(context, session);
    if (!uuidPattern.test(sessionId)) {
      authError(400, "invalid_request", "The session id is invalid.");
    }

    const revoked = await this.store.revokeSession({
      sessionId,
      userId: session.userId,
    });
    if (!revoked) {
      authError(404, "session_not_found", "The session does not exist.");
    }
    return {
      currentRevoked: sessionId === session.id,
      response: { status: "accepted" },
    };
  }

  async requireSession(
    context: RequestAuthContext
  ): Promise<AuthenticatedSession> {
    const authenticated = await this.resolveSession(context.sessionSecret);
    if (!authenticated) {
      authError(401, "unauthenticated", "Sign in to continue.");
    }
    return authenticated;
  }

  private async resolveSession(
    sessionSecret: string | undefined
  ): Promise<AuthenticatedSession | null> {
    if (!sessionSecret || !secretPattern.test(sessionSecret)) {
      return null;
    }

    const session = await this.store.findSessionByTokenHash(
      hashAuthSecret(sessionSecret)
    );
    if (!session || !this.isSessionActive(session)) {
      return null;
    }

    const user = await this.store.findUserById(session.userId);
    if (!user || user.status !== "active") {
      return null;
    }

    await this.store.touchSession(session.id);
    return { session, user };
  }

  private isSessionActive(session: SessionRow): boolean {
    const now = Date.now();
    const idleExpiresAt =
      session.lastSeenAt.getTime() + this.options.sessionIdleTtlSeconds * 1000;
    return (
      session.revokedAt === null &&
      session.absoluteExpiresAt.getTime() > now &&
      idleExpiresAt > now
    );
  }

  private requireCsrf(context: RequestAuthContext, session: SessionRow): void {
    if (
      context.origin !== undefined &&
      !this.options.trustedOrigins.includes(context.origin)
    ) {
      authError(403, "untrusted_origin", "The request origin is not trusted.");
    }
    if (
      !context.csrfToken ||
      !secretPattern.test(context.csrfToken) ||
      !hashesMatch(hashAuthSecret(context.csrfToken), session.csrfTokenHash)
    ) {
      authError(403, "invalid_csrf_token", "The CSRF token is invalid.");
    }
  }

  private async createSessionSecrets(
    userId: string,
    deviceSummary: string
  ): Promise<SessionSecrets> {
    const sessionSecret = generateAuthSecret();
    const csrfSecret = generateAuthSecret();
    await this.store.createSession({
      absoluteExpiresAt: this.absoluteExpiry(),
      csrfTokenHash: hashAuthSecret(csrfSecret),
      deviceSummary,
      tokenHash: hashAuthSecret(sessionSecret),
      userId,
    });
    return { csrfSecret, sessionSecret };
  }

  private absoluteExpiry(): Date {
    return new Date(Date.now() + this.options.sessionAbsoluteTtlSeconds * 1000);
  }

  private idleCutoff(): Date {
    return new Date(Date.now() - this.options.sessionIdleTtlSeconds * 1000);
  }
}
