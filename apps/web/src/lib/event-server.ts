import {
  eventDetailResponseSchema,
  eventListResponseSchema,
  type EventDetailResponse,
  type EventListResponse,
} from "@event-ticketing/contracts";

import { fetchAuthenticated } from "./auth-server";

export async function fetchEvents(
  apiBaseUrl: string,
  organizationId: string
): Promise<EventListResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/events`
  );
  const parsed = eventListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchEventDetail(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string
): Promise<EventDetailResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/events/${eventId}`
  );
  const parsed = eventDetailResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
