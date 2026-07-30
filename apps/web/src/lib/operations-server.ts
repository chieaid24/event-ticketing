import {
  operationsJobListResponseSchema,
  organizationAnalyticsResponseSchema,
  type OperationsJobListResponse,
  type OrganizationAnalyticsResponse,
} from "@event-ticketing/contracts";

import { fetchAuthenticated } from "./auth-server";

export async function fetchOrganizationAnalytics(
  apiBaseUrl: string,
  organizationId: string
): Promise<OrganizationAnalyticsResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/analytics`
  );
  const parsed = organizationAnalyticsResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchOrganizationJobs(
  apiBaseUrl: string,
  organizationId: string
): Promise<OperationsJobListResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/jobs`
  );
  const parsed = operationsJobListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
