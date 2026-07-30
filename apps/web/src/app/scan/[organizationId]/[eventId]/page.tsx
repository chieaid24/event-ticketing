import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../../components/site-header";
import { fetchCurrentUser } from "../../../../lib/auth-server";
import { fetchEventDetail } from "../../../../lib/event-server";
import { formatEventInstant } from "../../../../lib/format";
import { fetchInitialScanActivity } from "../../../../lib/scan-server";
import { ScannerClient } from "./scanner-client";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { follow: false, index: false },
  title: "Scan tickets | Event Ticketing Platform",
};

type PageProps = Readonly<{
  params: Promise<{ eventId: string; organizationId: string }>;
}>;

export default async function ScanEventPage({ params }: PageProps) {
  const config = loadWebConfig();
  const { eventId, organizationId } = await params;
  const me = await fetchCurrentUser(config.apiBaseUrl);

  if (!me) {
    return (
      <>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <main className="auth-shell" id="main-content">
          <h1 className="auth-shell__heading">Scan tickets</h1>
          <p className="form-status" role="status">
            <a href="/login">Sign in</a> to scan tickets.
          </p>
        </main>
      </>
    );
  }

  const detail = await fetchEventDetail(
    config.apiBaseUrl,
    organizationId,
    eventId
  );

  if (!detail) {
    return (
      <>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader signedIn />
        <main className="auth-shell" id="main-content">
          <h1 className="auth-shell__heading">Scan tickets</h1>
          <p className="form-status form-status--error" role="status">
            This event is not available to you. Pick one from the{" "}
            <a href="/scan">scanner event list</a>.
          </p>
        </main>
      </>
    );
  }

  const { event } = detail;
  const initialActivity = await fetchInitialScanActivity(
    config.apiBaseUrl,
    organizationId,
    eventId
  );

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <p className="eyebrow">Scanning for</p>
        <h1 className="auth-shell__heading">{event.title}</h1>
        <p className="auth-shell__summary">
          {event.startsAt
            ? formatEventInstant(event.startsAt, event.timezone)
            : "Date to be announced"}{" "}
          &middot; {detail.venue.name}
        </p>
        <ScannerClient
          apiBaseUrl={config.apiBaseUrl}
          eventId={eventId}
          initialActivity={initialActivity}
          organizationId={organizationId}
        />
      </main>
    </>
  );
}
