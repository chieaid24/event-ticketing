import { loadWebConfig } from "@event-ticketing/config";
import {
  DISCOVERY_DEFAULT_LIMIT,
  publicEventListQuerySchema,
  type PublicEventListQuery,
} from "@event-ticketing/contracts";

import { SiteHeader } from "../../components/site-header";
import { fetchCurrentUser } from "../../lib/auth-server";
import { fetchPublicEvents } from "../../lib/discovery-server";
import { formatEventInstant, formatMoney } from "../../lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Discover events | Event Ticketing Platform",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// malformed urls degrade to default listing not error page
function sanitizeQuery(params: SearchParams): PublicEventListQuery {
  const parsed = publicEventListQuerySchema.safeParse({
    ...(first(params["search"]) ? { search: first(params["search"]) } : {}),
    ...(first(params["timeframe"])
      ? { timeframe: first(params["timeframe"]) }
      : {}),
    ...(first(params["offset"]) ? { offset: first(params["offset"]) } : {}),
  });
  return parsed.success
    ? parsed.data
    : { limit: DISCOVERY_DEFAULT_LIMIT, offset: 0, timeframe: "upcoming" };
}

function listingHref(query: PublicEventListQuery, offset: number): string {
  const params = new URLSearchParams();
  if (query.search) {
    params.set("search", query.search);
  }
  if (query.timeframe !== "upcoming") {
    params.set("timeframe", query.timeframe);
  }
  if (offset > 0) {
    params.set("offset", String(offset));
  }
  const suffix = params.toString();
  return suffix ? `/events?${suffix}` : "/events";
}

const timeframeLabels = {
  all: "All events",
  past: "Past events",
  upcoming: "Upcoming events",
} as const;

const timeframeNouns = {
  all: "events",
  past: "past events",
  upcoming: "upcoming events",
} as const;

export default async function PublicEventsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const config = loadWebConfig();
  const query = sanitizeQuery(await searchParams);
  const [me, result] = await Promise.all([
    fetchCurrentUser(config.apiBaseUrl),
    fetchPublicEvents(config.apiBaseUrl, query),
  ]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn={Boolean(me)} />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <h1 className="auth-shell__heading">Discover events</h1>
        <p className="auth-shell__summary">
          Browse published events. Availability shown anywhere on these pages is
          advisory; seats and admission are only reserved once checkout confirms
          a hold.
        </p>

        <form
          action="/events"
          className="event-search"
          method="get"
          role="search"
        >
          <div className="form-field event-search__term">
            <label htmlFor="event-search-input">Search events</label>
            <input
              defaultValue={query.search ?? ""}
              id="event-search-input"
              maxLength={100}
              name="search"
              placeholder="Title or description"
              type="search"
            />
          </div>
          <div className="form-field">
            <label htmlFor="event-search-timeframe">Timeframe</label>
            <select
              defaultValue={query.timeframe}
              id="event-search-timeframe"
              name="timeframe"
            >
              {Object.entries(timeframeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button className="button-primary" type="submit">
            Search
          </button>
        </form>

        {result.kind === "error" ? (
          <p className="form-status form-status--error" role="alert">
            Loading events failed. <a href={listingHref(query, 0)}>Try again</a>
            .
          </p>
        ) : (
          <EventListing query={query} response={result.data} />
        )}
      </main>
    </>
  );
}

function EventListing({
  query,
  response,
}: Readonly<{
  query: PublicEventListQuery;
  response: {
    events: readonly {
      currency: string;
      id: string;
      minPriceMinor: number;
      startsAt: string;
      timezone: string;
      title: string;
      venueName: string;
    }[];
    pagination: { limit: number; offset: number; total: number };
  };
}>) {
  const { events, pagination } = response;

  if (events.length === 0) {
    return (
      <p className="form-status" role="status">
        {query.search
          ? `No ${timeframeNouns[query.timeframe]} match "${query.search}". `
          : `No ${timeframeNouns[query.timeframe]} are on sale right now. `}
        {query.search || query.timeframe !== "upcoming" ? (
          <a href="/events">Clear the search</a>
        ) : (
          "Check back soon."
        )}
      </p>
    );
  }

  const from = pagination.offset + 1;
  const to = pagination.offset + events.length;
  const previousOffset = Math.max(0, pagination.offset - pagination.limit);
  const nextOffset = pagination.offset + pagination.limit;

  return (
    <section aria-labelledby="event-results-heading">
      <h2 className="sr-only" id="event-results-heading">
        Search results
      </h2>
      <p className="event-results-count" role="status">
        Showing {from}-{to} of {pagination.total}{" "}
        {pagination.total === 1 ? "event" : "events"}.
      </p>
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id}>
            <div>
              <p className="event-list__title">
                <a href={`/events/${event.id}`}>{event.title}</a>
              </p>
              <p className="event-list__meta">
                {event.venueName} &middot;{" "}
                {formatEventInstant(event.startsAt, event.timezone)}
              </p>
            </div>
            <p className="event-list__price">
              From {formatMoney(event.minPriceMinor, event.currency)}
            </p>
          </li>
        ))}
      </ul>
      {(pagination.offset > 0 || nextOffset < pagination.total) && (
        <nav aria-label="Result pages" className="pagination">
          {pagination.offset > 0 ? (
            <a href={listingHref(query, previousOffset)}>Previous page</a>
          ) : (
            <span aria-hidden="true" />
          )}
          {nextOffset < pagination.total && (
            <a href={listingHref(query, nextOffset)}>Next page</a>
          )}
        </nav>
      )}
    </section>
  );
}
