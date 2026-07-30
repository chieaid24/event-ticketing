import {
  checkInResponseSchema,
  reversalResponseSchema,
  scanActivityResponseSchema,
  type CheckInResponse,
  type ReversalResponse,
  type ScanActivityResponse,
} from "@event-ticketing/contracts";

import { AuthApiError, requestJson } from "./auth-api";

const DEVICE_STORAGE_KEY = "et_scan_device";

/**
 * A stable random identifier for this scanning device, minted once and kept in
 * local storage. It attributes scans and feeds per-device rate limits; it
 * grants nothing.
 */
export function readScanDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const minted = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_STORAGE_KEY, minted);
    return minted;
  } catch {
    // Storage can be unavailable in private modes; a per-page id still works.
    return crypto.randomUUID();
  }
}

/**
 * Submits one credential for check-in. The raw QR value goes straight to the
 * API over HTTPS and is never kept, logged, or shown by the client.
 */
export async function postCheckIn(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string,
  input: {
    credential: { publicNumber: string } | { qrToken: string };
    deviceId: string;
  }
): Promise<CheckInResponse> {
  return checkInResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/events/${eventId}/scanner/checkins`,
      {
        body: { deviceId: input.deviceId, ...input.credential },
        csrf: true,
        method: "POST",
      }
    )
  );
}

export async function postReversal(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string,
  input: { deviceId: string; reason: string; ticketId: string }
): Promise<ReversalResponse> {
  return reversalResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/events/${eventId}/scanner/reversals`,
      { body: input, csrf: true, method: "POST" }
    )
  );
}

export async function fetchScanActivity(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string
): Promise<ScanActivityResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${organizationId}/events/${eventId}/scanner/activity`,
      {
        cache: "no-store",
        credentials: "include",
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    throw new AuthApiError(
      "network_error",
      "The service could not be reached. Try again."
    );
  }
  if (!response.ok) {
    throw new AuthApiError(
      "activity_unavailable",
      "Recent activity could not be loaded."
    );
  }
  return scanActivityResponseSchema.parse(await response.json());
}
