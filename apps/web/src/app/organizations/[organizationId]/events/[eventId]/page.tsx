import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../../../components/site-header";
import { fetchCurrentUser } from "../../../../../lib/auth-server";
import { fetchEventDetail } from "../../../../../lib/event-server";
import { fetchOrganizationDetail } from "../../../../../lib/org-server";
import { EventDetailPanels } from "./event-detail-panels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Event | Event Ticketing Platform",
};

export default async function EventDetailPage({
  params,
}: Readonly<{
  params: Promise<{ eventId: string; organizationId: string }>;
}>) {
  const config = loadWebConfig();
  const me = await fetchCurrentUser(config.apiBaseUrl);
  if (!me) {
    redirect("/login");
  }

  const { eventId, organizationId } = await params;
  const orgDetail = await fetchOrganizationDetail(
    config.apiBaseUrl,
    organizationId
  );
  if (!orgDetail) {
    redirect("/organizations");
  }
  const detail = await fetchEventDetail(
    config.apiBaseUrl,
    organizationId,
    eventId
  );
  if (!detail) {
    redirect(`/organizations/${organizationId}/events`);
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <p className="auth-shell__summary">
          <a href={`/organizations/${organizationId}/events`}>
            {orgDetail.organization.name} events
          </a>
        </p>
        <h1 className="auth-shell__heading">{detail.event.title}</h1>
        <p className="auth-shell__summary">
          {detail.venue.name}
          {detail.event.status === "published" ? " (published)" : " (draft)"}
        </p>
        <EventDetailPanels
          apiBaseUrl={config.apiBaseUrl}
          canManage={orgDetail.membership.permissions.includes("events.manage")}
          detail={detail}
          organizationId={organizationId}
        />
      </main>
    </>
  );
}
