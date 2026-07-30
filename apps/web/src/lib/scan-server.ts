import {
  scanActivityResponseSchema,
  type ScanActivityResponse,
} from "@event-ticketing/contracts";

import { fetchAuthenticated } from "./auth-server";

export async function fetchInitialScanActivity(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string
): Promise<ScanActivityResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/events/${eventId}/scanner/activity`
  );
  const parsed = scanActivityResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
