import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../components/site-header";
import { fetchCurrentUser } from "../../lib/auth-server";
import { fetchOrganizations } from "../../lib/org-server";
import { OrganizationsPanels } from "./organizations-panels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Organizations | Event Ticketing Platform",
};

export default async function OrganizationsPage() {
  const config = loadWebConfig();
  const me = await fetchCurrentUser(config.apiBaseUrl);
  if (!me) {
    redirect("/login");
  }
  const list = await fetchOrganizations(config.apiBaseUrl);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <h1 className="auth-shell__heading">Organizations</h1>
        <p className="auth-shell__summary">
          Organizations you belong to, invitations waiting for you, and a form
          to start a new one.
        </p>
        <OrganizationsPanels
          apiBaseUrl={config.apiBaseUrl}
          invitations={list?.invitations ?? []}
          organizations={list?.organizations ?? []}
        />
      </main>
    </>
  );
}
