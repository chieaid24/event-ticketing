import {
  venueDetailResponseSchema,
  venueListResponseSchema,
  type VenueDetailResponse,
  type VenueListResponse,
} from "@event-ticketing/contracts";

import { fetchAuthenticated } from "./auth-server";

export async function fetchVenues(
  apiBaseUrl: string,
  organizationId: string
): Promise<VenueListResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/venues`
  );
  const parsed = venueListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchVenueDetail(
  apiBaseUrl: string,
  organizationId: string,
  venueId: string
): Promise<VenueDetailResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/venues/${venueId}`
  );
  const parsed = venueDetailResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
