import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../components/site-header";
import { fetchCurrentUser } from "../../../lib/auth-server";
import {
  fetchAuditLogs,
  fetchMembers,
  fetchOrganizationDetail,
} from "../../../lib/org-server";
import { OrganizationDetailPanels } from "./organization-detail-panels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Organization | Event Ticketing Platform",
};

export default async function OrganizationDetailPage({
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

  const permissions = detail.membership.permissions;
  const members = permissions.includes("members.read")
    ? await fetchMembers(config.apiBaseUrl, organizationId)
    : null;
  const auditLogs = permissions.includes("audit.read")
    ? await fetchAuditLogs(config.apiBaseUrl, organizationId)
    : null;

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <p className="auth-shell__summary">
          <a href="/organizations">All organizations</a>
        </p>
        <h1 className="auth-shell__heading">{detail.organization.name}</h1>
        <p className="auth-shell__summary">/{detail.organization.slug}</p>
        <p className="auth-shell__summary">
          <a href={`/organizations/${organizationId}/venues`}>Manage venues</a>
        </p>
        <OrganizationDetailPanels
          apiBaseUrl={config.apiBaseUrl}
          auditEntries={auditLogs?.entries ?? null}
          currentUserId={me.user.id}
          detail={detail}
          members={members?.members ?? null}
        />
      </main>
    </>
  );
}
