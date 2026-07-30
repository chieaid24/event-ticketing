import {
  acceptedResponseSchema,
  type AcceptedResponse,
} from "@event-ticketing/contracts";

import { requestJson } from "./auth-api";

export async function retryOrganizationJob(
  apiBaseUrl: string,
  organizationId: string,
  jobId: string,
  expectedUpdatedAt: string
): Promise<AcceptedResponse> {
  return acceptedResponseSchema.parse(
    await requestJson(
      apiBaseUrl,
      `/organizations/${organizationId}/jobs/${jobId}/retry`,
      {
        body: { expectedUpdatedAt },
        csrf: true,
        method: "POST",
      }
    )
  );
}
