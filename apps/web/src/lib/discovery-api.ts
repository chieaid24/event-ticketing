import {
  eventAvailabilityResponseSchema,
  type EventAvailabilityResponse,
} from "@event-ticketing/contracts";

export class DiscoveryApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryApiError";
  }
}

// public availability reads stay uncached
export async function fetchEventAvailability(
  apiBaseUrl: string,
  eventId: string,
  request: typeof fetch = fetch
): Promise<EventAvailabilityResponse> {
  let response: Response;
  try {
    response = await request(
      `${apiBaseUrl}/discovery/events/${encodeURIComponent(
        eventId
      )}/availability`,
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    throw new DiscoveryApiError("Loading availability failed.");
  }
  if (!response.ok) {
    throw new DiscoveryApiError("Loading availability failed.");
  }
  const parsed = eventAvailabilityResponseSchema.safeParse(
    await response.json().catch(() => null)
  );
  if (!parsed.success) {
    throw new DiscoveryApiError("The availability response was invalid.");
  }
  return parsed.data;
}
