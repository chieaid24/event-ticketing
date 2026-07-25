import {
  acceptedResponseSchema,
  organizationDetailResponseSchema,
  type AcceptedResponse,
  type ChangeMemberRoleRequest,
  type CreateOrganizationRequest,
  type InviteMemberRequest,
  type OrganizationDetailResponse,
  type UpdateOrganizationSettingsRequest,
} from "@event-ticketing/contracts";

import { requestJson } from "./auth-api";

export async function createOrganization(
  apiBaseUrl: string,
  input: CreateOrganizationRequest
): Promise<OrganizationDetailResponse> {
  return organizationDetailResponseSchema.parse(
    await requestJson(apiBaseUrl, "/organizations", {
      body: input,
      csrf: true,
      method: "POST",
    })
  );
}

export async function updateOrganizationSettings(
  apiBaseUrl: string,
  organizationId: string,
  input: UpdateOrganizationSettingsRequest
): Promise<OrganizationDetailResponse> {
  return organizationDetailResponseSchema.parse(
    await requestJson(apiBaseUrl, `/organizations/${organizationId}`, {
      body: input,
      csrf: true,
      method: "PATCH",
    })
  );
}

export async function deleteOrganization(
  apiBaseUrl: string,
  organizationId: string,
  confirmSlug: string
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(apiBaseUrl, `/organizations/${organizationId}`, {
      body: { confirmSlug },
      csrf: true,
      method: "DELETE",
    })
  );
}

export async function inviteMember(
  apiBaseUrl: string,
  organizationId: string,
  input: InviteMemberRequest
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(apiBaseUrl, `/organizations/${organizationId}/members`, {
      body: input,
      csrf: true,
      method: "POST",
    })
  );
}

export async function changeMemberRole(
  apiBaseUrl: string,
  organizationId: string,
  membershipId: string,
  input: ChangeMemberRoleRequest
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/members/${membershipId}`,
      { body: input, csrf: true, method: "PATCH" }
    )
  );
}

export async function removeMember(
  apiBaseUrl: string,
  organizationId: string,
  membershipId: string
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/members/${membershipId}`,
      { csrf: true, method: "DELETE" }
    )
  );
}

export async function respondToInvitation(
  apiBaseUrl: string,
  membershipId: string,
  response: "accept" | "decline"
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/invitations/${membershipId}/${response}`,
      { csrf: true, method: "POST" }
    )
  );
}
