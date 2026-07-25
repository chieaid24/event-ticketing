import {
  acceptedResponseSchema,
  apiErrorSchema,
  changePasswordResponseSchema,
  loginResponseSchema,
  resetPasswordResponseSchema,
  verifyEmailResponseSchema,
  type AcceptedResponse,
  type ChangePasswordResponse,
  type LoginResponse,
  type ResetPasswordResponse,
  type VerifyEmailResponse,
} from "@event-ticketing/contracts";

const CSRF_COOKIE_NAME = "et_csrf";

export class AuthApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

export function readCsrfToken(): string | undefined {
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CSRF_COOKIE_NAME}=`));
  const value = entry?.slice(CSRF_COOKIE_NAME.length + 1);
  return value || undefined;
}

export async function requestJson(
  apiBaseUrl: string,
  path: string,
  init: {
    body?: unknown;
    csrf?: boolean;
    method: "PATCH" | "POST" | "DELETE";
  }
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (init.csrf) {
    const csrfToken = readCsrfToken();
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      body: init.body === undefined ? null : JSON.stringify(init.body),
      credentials: "include",
      headers,
      method: init.method,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AuthApiError(
      "network_error",
      "The service could not be reached. Try again."
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    throw new AuthApiError(
      parsed.success ? parsed.data.code : "unknown_error",
      parsed.success ? parsed.data.message : "The request failed. Try again."
    );
  }
  return payload;
}

export async function registerAccount(
  apiBaseUrl: string,
  input: { email: string; password: string }
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(apiBaseUrl, "/auth/register", {
      body: input,
      method: "POST",
    })
  );
}

export async function verifyEmail(
  apiBaseUrl: string,
  token: string
): Promise<VerifyEmailResponse> {
  return verifyEmailResponseSchema.parse(
    await requestJson(apiBaseUrl, "/auth/verify-email", {
      body: { token },
      method: "POST",
    })
  );
}

export async function login(
  apiBaseUrl: string,
  input: { email: string; password: string }
): Promise<LoginResponse> {
  return loginResponseSchema.parse(
    await requestJson(apiBaseUrl, "/auth/login", {
      body: input,
      method: "POST",
    })
  );
}

export async function logout(apiBaseUrl: string): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(apiBaseUrl, "/auth/logout", {
      csrf: true,
      method: "POST",
    })
  );
}

export async function forgotPassword(
  apiBaseUrl: string,
  email: string
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(apiBaseUrl, "/auth/forgot-password", {
      body: { email },
      method: "POST",
    })
  );
}

export async function resetPassword(
  apiBaseUrl: string,
  input: { password: string; token: string }
): Promise<ResetPasswordResponse> {
  return resetPasswordResponseSchema.parse(
    await requestJson(apiBaseUrl, "/auth/reset-password", {
      body: input,
      method: "POST",
    })
  );
}

export async function changePassword(
  apiBaseUrl: string,
  input: { currentPassword: string; newPassword: string }
): Promise<ChangePasswordResponse> {
  return changePasswordResponseSchema.parse(
    await requestJson(apiBaseUrl, "/auth/change-password", {
      body: input,
      csrf: true,
      method: "POST",
    })
  );
}

export async function revokeSession(
  apiBaseUrl: string,
  sessionId: string
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(apiBaseUrl, `/auth/sessions/${sessionId}`, {
      csrf: true,
      method: "DELETE",
    })
  );
}
