import { cookies } from "next/headers";

import {
  meResponseSchema,
  sessionListResponseSchema,
  type MeResponse,
  type SessionListResponse,
} from "@event-ticketing/contracts";

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function fetchAuthenticated(
  apiBaseUrl: string,
  path: string
): Promise<unknown | null> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        cookie: await cookieHeader(),
      },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function fetchCurrentUser(
  apiBaseUrl: string
): Promise<MeResponse | null> {
  const payload = await fetchAuthenticated(apiBaseUrl, "/auth/me");
  const parsed = meResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchSessions(
  apiBaseUrl: string
): Promise<SessionListResponse | null> {
  const payload = await fetchAuthenticated(apiBaseUrl, "/auth/sessions");
  const parsed = sessionListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
