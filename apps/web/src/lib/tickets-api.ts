import {
  qrRevealResponseSchema,
  type QrRevealResponse,
} from "@event-ticketing/contracts";

import { requestJson } from "./auth-api";

// rotate bearer without retaining the raw token
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
