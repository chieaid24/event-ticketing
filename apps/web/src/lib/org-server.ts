import {
  auditLogListResponseSchema,
  memberListResponseSchema,
  organizationDetailResponseSchema,
  organizationListResponseSchema,
  type AuditLogListResponse,
  type MemberListResponse,
  type OrganizationDetailResponse,
  type OrganizationListResponse,
} from "@event-ticketing/contracts";

import { fetchAuthenticated } from "./auth-server";

export async function fetchOrganizations(
  apiBaseUrl: string
): Promise<OrganizationListResponse | null> {
  const payload = await fetchAuthenticated(apiBaseUrl, "/organizations");
  const parsed = organizationListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchOrganizationDetail(
  apiBaseUrl: string,
  organizationId: string
): Promise<OrganizationDetailResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}`
  );
  const parsed = organizationDetailResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchMembers(
  apiBaseUrl: string,
  organizationId: string
): Promise<MemberListResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/members`
  );
  const parsed = memberListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function fetchAuditLogs(
  apiBaseUrl: string,
  organizationId: string
): Promise<AuditLogListResponse | null> {
  const payload = await fetchAuthenticated(
    apiBaseUrl,
    `/organizations/${organizationId}/audit-logs`
  );
  const parsed = auditLogListResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
