import { loadWebConfig } from "@event-ticketing/config";
import type { EventSummary } from "@event-ticketing/contracts";

import { SiteHeader } from "../../components/site-header";
import { fetchCurrentUser } from "../../lib/auth-server";
import { fetchEvents } from "../../lib/event-server";
import { fetchOrganizations } from "../../lib/org-server";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { follow: false, index: false },
  title: "Scanner | Event Ticketing Platform",
};

/**
 * Mirrors the scanner.checkin column of docs/security/authorization.md for
 * visibility only; the API enforces the permission on every scan.
 */
const scanningRoles = new Set(["owner", "admin", "scanner"]);

/** Gate scanning only makes sense for events that are on sale or running. */
function scannable(event: EventSummary): boolean {
  return event.status === "published" || event.status === "sales_paused";
}

function eventDate(startsAt: string | null): string {
  if (!startsAt) {
    return "Date to be announced";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(startsAt));
}

export default async function ScanIndexPage() {
  const config = loadWebConfig();
  const me = await fetchCurrentUser(config.apiBaseUrl);

  if (!me) {
    return (
      <>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <main className="auth-shell" id="main-content">
          <h1 className="auth-shell__heading">Scanner</h1>
          <p className="form-status" role="status">
            <a href="/login">Sign in</a> to scan tickets.
          </p>
        </main>
      </>
    );
  }

  const data = await fetchOrganizations(config.apiBaseUrl);
  const organizations = (data?.organizations ?? []).filter((organization) =>
    scanningRoles.has(organization.role)
  );
  const sections = await Promise.all(
    organizations.map(async (organization) => {
      const events = await fetchEvents(config.apiBaseUrl, organization.id);
      return {
        events: (events?.events ?? []).filter(scannable),
        organization,
      };
    })
  );
  const withEvents = sections.filter((section) => section.events.length > 0);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <h1 className="auth-shell__heading">Scanner</h1>
        <p className="auth-shell__summary">
          Select the event you are scanning tickets for.
        </p>
        {withEvents.length === 0 ? (
          <p className="form-status" role="status">
            No scannable events. You need a scanner, admin, or owner role in an
            organization with a published event.
          </p>
        ) : (
          withEvents.map(({ events, organization }) => (
            <section
              aria-label={organization.name}
              className="account-section"
              key={organization.id}
            >
              <h2>{organization.name}</h2>
              <ul aria-label="Scannable events" className="ticket-list">
                {events.map((event) => (
                  <li className="ticket-list__item" key={event.id}>
                    <div className="ticket-list__body">
                      <p className="ticket-list__title">
                        <a href={`/scan/${organization.id}/${event.id}`}>
                          {event.title}
                        </a>
                      </p>
                      <p className="ticket-list__meta">
                        {eventDate(event.startsAt)} &middot; {event.venueName}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </>
  );
}
