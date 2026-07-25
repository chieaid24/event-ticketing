import type { Request } from "express";

import type { RequestAuthContext } from "./auth/auth.service.js";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "./auth/cookies.js";

export function contextFrom(request: Request): RequestAuthContext {
  const cookies = parseCookieHeader(request.headers.cookie);
  return {
    csrfToken: request.header("x-csrf-token"),
    origin: request.header("origin"),
    sessionSecret: cookies[SESSION_COOKIE_NAME],
  };
}

export function deviceSummaryFrom(request: Request): string {
  const userAgent = request.header("user-agent") ?? "";
  const printable = userAgent.replace(/[^\x20-\x7E]/g, " ").trim();
  return printable.slice(0, 160) || "unknown";
}
