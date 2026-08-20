import { parseCookie, stringifySetCookie } from "cookie";

export const SESSION_COOKIE_NAME = "et_session";
export const CSRF_COOKIE_NAME = "et_csrf";

export interface AuthCookieSettings {
  maxAgeSeconds: number;
  secure: boolean;
}

export interface SessionSecrets {
  csrfSecret: string;
  sessionSecret: string;
}

export function parseCookieHeader(
  header: string | undefined
): Record<string, string | undefined> {
  return header ? parseCookie(header) : {};
}

export function buildSessionCookies(
  secrets: SessionSecrets,
  settings: AuthCookieSettings
): string[] {
  const shared = {
    maxAge: settings.maxAgeSeconds,
    path: "/",
    sameSite: "lax" as const,
    secure: settings.secure,
  };
  return [
    stringifySetCookie({
      ...shared,
      httpOnly: true,
      name: SESSION_COOKIE_NAME,
      value: secrets.sessionSecret,
    }),
    // readable by frontend to echo double-submit csrf header
    stringifySetCookie({
      ...shared,
      httpOnly: false,
      name: CSRF_COOKIE_NAME,
      value: secrets.csrfSecret,
    }),
  ];
}

export function buildClearedSessionCookies(
  settings: Pick<AuthCookieSettings, "secure">
): string[] {
  const shared = {
    maxAge: 0,
    path: "/",
    sameSite: "lax" as const,
    secure: settings.secure,
  };
  return [
    stringifySetCookie({
      ...shared,
      httpOnly: true,
      name: SESSION_COOKIE_NAME,
      value: "",
    }),
    stringifySetCookie({
      ...shared,
      httpOnly: false,
      name: CSRF_COOKIE_NAME,
      value: "",
    }),
  ];
}
