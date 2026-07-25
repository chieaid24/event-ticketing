import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../../components/site-header";
import { fetchCurrentUser } from "../../../../lib/auth-server";
import { fetchOrganizationDetail } from "../../../../lib/org-server";
import { fetchVenues } from "../../../../lib/venue-server";
import { VenuesPanels } from "./venues-panels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Venues | Event Ticketing Platform",
};

export default async function VenuesPage({
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
  const venues = await fetchVenues(config.apiBaseUrl, organizationId);

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
        <h1 className="auth-shell__heading">Venues</h1>
        <p className="auth-shell__summary">
          Reusable place and layout templates. Events reference a venue and
          snapshot its seats at publication.
        </p>
        <VenuesPanels
          apiBaseUrl={config.apiBaseUrl}
          canManage={detail.membership.permissions.includes("venues.manage")}
          organizationId={organizationId}
          venues={venues?.venues ?? []}
        />
      </main>
    </>
  );
}
