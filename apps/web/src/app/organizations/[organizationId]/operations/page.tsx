import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../../components/site-header";
import { fetchCurrentUser } from "../../../../lib/auth-server";
import { fetchOrganizationDetail } from "../../../../lib/org-server";
import {
  fetchOrganizationAnalytics,
  fetchOrganizationJobs,
} from "../../../../lib/operations-server";
import { OperationsDashboard } from "./operations-dashboard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Operations | Event Ticketing Platform",
};

export default async function OperationsPage({
  params,
}: Readonly<{ params: Promise<{ organizationId: string }> }>) {
  const config = loadWebConfig();
  if (!(await fetchCurrentUser(config.apiBaseUrl))) {
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
  if (
    !permissions.includes("analytics.read") &&
    !permissions.includes("operations.read")
  ) {
    redirect(`/organizations/${organizationId}`);
  }

  const [analytics, jobs] = await Promise.all([
    permissions.includes("analytics.read")
      ? fetchOrganizationAnalytics(config.apiBaseUrl, organizationId)
      : null,
    permissions.includes("operations.read")
      ? fetchOrganizationJobs(config.apiBaseUrl, organizationId)
      : null,
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
        <h1 className="auth-shell__heading">Operations</h1>
        <p className="auth-shell__summary">
          Reconcile sales and inventory, then inspect work that needs attention.
        </p>
        <OperationsDashboard
          analytics={analytics}
          apiBaseUrl={config.apiBaseUrl}
          canRetryJobs={permissions.includes("operations.manage")}
          jobs={jobs?.jobs ?? null}
          organizationId={organizationId}
        />
      </main>
    </>
  );
}
