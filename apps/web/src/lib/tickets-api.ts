import {
  qrRevealResponseSchema,
  type QrRevealResponse,
} from "@event-ticketing/contracts";

import { requestJson } from "./auth-api";

/**
 * Mints and returns a fresh QR bearer for a ticket. The prior bearer stops
 * working the moment this resolves. The raw token lives only in the caller's
 * memory - render it, never store or log it.
 */
export async function revealTicketQr(
  apiBaseUrl: string,
  ticketId: string
): Promise<QrRevealResponse> {
  return qrRevealResponseSchema.parse(
    await requestJson(apiBaseUrl, `/tickets/${ticketId}/qr`, {
      csrf: true,
      method: "POST",
    })
  );
}
