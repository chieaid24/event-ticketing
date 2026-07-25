import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../../../components/site-header";
import { fetchCurrentUser } from "../../../../../lib/auth-server";
import { fetchOrganizationDetail } from "../../../../../lib/org-server";
import { fetchVenueDetail } from "../../../../../lib/venue-server";
import { VenueDetailPanels } from "./venue-detail-panels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Venue | Event Ticketing Platform",
};

export default async function VenueDetailPage({
  params,
}: Readonly<{
  params: Promise<{ organizationId: string; venueId: string }>;
}>) {
  const config = loadWebConfig();
  const me = await fetchCurrentUser(config.apiBaseUrl);
  if (!me) {
    redirect("/login");
  }

  const { organizationId, venueId } = await params;
  const orgDetail = await fetchOrganizationDetail(
    config.apiBaseUrl,
    organizationId
  );
  if (!orgDetail) {
    redirect("/organizations");
  }
  const detail = await fetchVenueDetail(
    config.apiBaseUrl,
    organizationId,
    venueId
  );
  if (!detail) {
    redirect(`/organizations/${organizationId}/venues`);
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <p className="auth-shell__summary">
          <a href={`/organizations/${organizationId}/venues`}>
            {orgDetail.organization.name} venues
          </a>
        </p>
        <h1 className="auth-shell__heading">{detail.venue.name}</h1>
        {detail.venue.description ? (
          <p className="auth-shell__summary">{detail.venue.description}</p>
        ) : null}
        <VenueDetailPanels
          apiBaseUrl={config.apiBaseUrl}
          canManage={orgDetail.membership.permissions.includes("venues.manage")}
          detail={detail}
          organizationId={organizationId}
        />
      </main>
    </>
  );
}
