import {
  publicEventDetailResponseSchema,
  publicEventListResponseSchema,
  type PublicEventDetailResponse,
  type PublicEventListResponse,
} from "@event-ticketing/contracts";

export interface PublicEventListInput {
  limit?: number | undefined;
  offset?: number | undefined;
  search?: string | undefined;
  timeframe?: "all" | "past" | "upcoming" | undefined;
}

export type PublicEventListResult =
  { data: PublicEventListResponse; kind: "ok" } | { kind: "error" };

export type PublicEventDetailResult =
  | { data: PublicEventDetailResponse; kind: "ok" }
  | { kind: "not_found" }
  | { kind: "error" };

/** Public reads carry no cookies; discovery never depends on a session. */
export async function fetchPublicEvents(
  apiBaseUrl: string,
  input: PublicEventListInput,
  request: typeof fetch = fetch
): Promise<PublicEventListResult> {
  const query = new URLSearchParams();
  if (input.search) {
    query.set("search", input.search);
  }
  if (input.timeframe) {
    query.set("timeframe", input.timeframe);
  }
  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    query.set("offset", String(input.offset));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  try {
    const response = await request(`${apiBaseUrl}/discovery/events${suffix}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      return { kind: "error" };
    }
    const parsed = publicEventListResponseSchema.safeParse(
      await response.json()
    );
    return parsed.success
      ? { data: parsed.data, kind: "ok" }
      : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export async function fetchPublicEventDetail(
  apiBaseUrl: string,
  eventId: string,
  request: typeof fetch = fetch
): Promise<PublicEventDetailResult> {
  try {
    const response = await request(
      `${apiBaseUrl}/discovery/events/${encodeURIComponent(eventId)}`,
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(2_000),
      }
    );
    if (response.status === 404) {
      return { kind: "not_found" };
    }
    if (!response.ok) {
      return { kind: "error" };
    }
    const parsed = publicEventDetailResponseSchema.safeParse(
      await response.json()
    );
    return parsed.success
      ? { data: parsed.data, kind: "ok" }
      : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}
