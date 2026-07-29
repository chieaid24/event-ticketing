import {
  ticketListResponseSchema,
  ticketSummarySchema,
  type TicketListResponse,
  type TicketSummary,
} from "@event-ticketing/contracts";

import { fetchAuthenticated } from "./auth-server";

export async function fetchTickets(
  apiBaseUrl: string
): Promise<TicketListResponse | null> {
  const payload = await fetchAuthenticated(apiBaseUrl, "/account/tickets");
  const parsed = ticketListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchTicket(
  apiBaseUrl: string,
  ticketId: string
): Promise<TicketSummary | null> {
  const payload = await fetchAuthenticated(apiBaseUrl, `/tickets/${ticketId}`);
  const parsed = ticketSummarySchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
