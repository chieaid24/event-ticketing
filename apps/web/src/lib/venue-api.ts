import {
  acceptedResponseSchema,
  venueDetailResponseSchema,
  type AcceptedResponse,
  type CreateVenueRequest,
  type ReplaceVenueLayoutRequest,
  type UpdateVenueRequest,
  type VenueDetailResponse,
} from "@event-ticketing/contracts";

import { requestJson } from "./auth-api";

export async function createVenue(
  apiBaseUrl: string,
  organizationId: string,
  input: CreateVenueRequest
): Promise<VenueDetailResponse> {
  return venueDetailResponseSchema.parse(
    await requestJson(apiBaseUrl, `/organizations/${organizationId}/venues`, {
      body: input,
      csrf: true,
      method: "POST",
    })
  );
}

export async function updateVenue(
  apiBaseUrl: string,
  organizationId: string,
  venueId: string,
  input: UpdateVenueRequest
): Promise<VenueDetailResponse> {
  return venueDetailResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/venues/${venueId}`,
      { body: input, csrf: true, method: "PATCH" }
    )
  );
}

export async function replaceVenueLayout(
  apiBaseUrl: string,
  organizationId: string,
  venueId: string,
  input: ReplaceVenueLayoutRequest
): Promise<VenueDetailResponse> {
  return venueDetailResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/venues/${venueId}/layout`,
      { body: input, csrf: true, method: "PUT" }
    )
  );
}

export async function deleteVenue(
  apiBaseUrl: string,
  organizationId: string,
  venueId: string
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/venues/${venueId}`,
      { csrf: true, method: "DELETE" }
    )
  );
}
