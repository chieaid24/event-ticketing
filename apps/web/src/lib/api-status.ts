import {
  statusResponseSchema,
  type StatusResponse,
} from "@event-ticketing/contracts";

export type ApiStatusResult =
  | {
      data: StatusResponse;
      kind: "available";
    }
  | {
      kind: "unavailable";
    };

export async function fetchApiStatus(
  apiBaseUrl: string,
  request: typeof fetch = fetch
): Promise<ApiStatusResult> {
  try {
    const response = await request(`${apiBaseUrl}/status`, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
      return { kind: "unavailable" };
    }

    const parsed = statusResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { data: parsed.data, kind: "available" }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
