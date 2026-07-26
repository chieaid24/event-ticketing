import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../../components/site-header";
import { fetchCurrentUser } from "../../../../lib/auth-server";
import { fetchEvents } from "../../../../lib/event-server";
import { fetchOrganizationDetail } from "../../../../lib/org-server";
import { fetchVenues } from "../../../../lib/venue-server";
import { EventsPanels } from "./events-panels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Events | Event Ticketing Platform",
};

export default async function EventsPage({
  params,
}: Readonly<{ params: Promise<{ organizationId: string }> }>) {
  const config = loadWebConfig();
  const me = await fetchCurrentUser(config.apiBaseUrl);
  if (!me) {
    redirect("/login");
  }

  const { organizationId } = await params;
  const detail = await fetchOrganizationDetail(
    config.apiBaseUrl,
    organizationId
  );
  if (!detail) {
    redirect("/organizations");
  }
  const canManage = detail.membership.permissions.includes("events.manage");
  const [events, venues] = await Promise.all([
    fetchEvents(config.apiBaseUrl, organizationId),
    canManage ? fetchVenues(config.apiBaseUrl, organizationId) : null,
  ]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <p className="auth-shell__summary">
          <a href={`/organizations/${organizationId}`}>
            {detail.organization.name}
          </a>
        </p>
        <h1 className="auth-shell__heading">Events</h1>
        <p className="auth-shell__summary">
          Draft an event against a venue, configure ticket types, then publish.
          Publication snapshots the venue seats so later layout edits never
          change sold inventory.
        </p>
        <EventsPanels
          apiBaseUrl={config.apiBaseUrl}
          canManage={canManage}
          events={events?.events ?? []}
          organizationId={organizationId}
          venues={venues?.venues ?? []}
        />
      </main>
    </>
  );
}
