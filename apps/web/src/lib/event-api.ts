import {
  eventDetailResponseSchema,
  type CreateEventRequest,
  type EventDetailResponse,
  type PublishEventRequest,
  type ReplaceTicketTypesRequest,
  type UpdateEventDraftRequest,
} from "@event-ticketing/contracts";

import { requestJson } from "./auth-api";

export async function createEvent(
  apiBaseUrl: string,
  organizationId: string,
  input: CreateEventRequest
): Promise<EventDetailResponse> {
  return eventDetailResponseSchema.parse(
    await requestJson(apiBaseUrl, `/organizations/${organizationId}/events`, {
      body: input,
      csrf: true,
      method: "POST",
    })
  );
}

export async function updateEventDraft(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string,
  input: UpdateEventDraftRequest
): Promise<EventDetailResponse> {
  return eventDetailResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/events/${eventId}`,
      { body: input, csrf: true, method: "PATCH" }
    )
  );
}

export async function replaceTicketTypes(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string,
  input: ReplaceTicketTypesRequest
): Promise<EventDetailResponse> {
  return eventDetailResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/events/${eventId}/ticket-types`,
      { body: input, csrf: true, method: "PUT" }
    )
  );
}

export async function publishEvent(
  apiBaseUrl: string,
  organizationId: string,
  eventId: string,
  input: PublishEventRequest
): Promise<EventDetailResponse> {
  return eventDetailResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/events/${eventId}/publish`,
      { body: input, csrf: true, method: "POST" }
    )
  );
}
