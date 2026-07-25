import { redirect } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../components/site-header";
import { fetchCurrentUser, fetchSessions } from "../../lib/auth-server";
import { AccountPanels } from "./account-panels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your account | Event Ticketing Platform",
};

export default async function AccountPage() {
  const config = loadWebConfig();
  const me = await fetchCurrentUser(config.apiBaseUrl);
  if (!me) {
    redirect("/login");
  }
  const sessions = await fetchSessions(config.apiBaseUrl);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <h1 className="auth-shell__heading">Your account</h1>
        <p className="auth-shell__summary">
          Manage your sign-in details and the devices where you are signed in.
        </p>
        <AccountPanels
          apiBaseUrl={config.apiBaseUrl}
          sessions={sessions?.sessions ?? []}
          user={me.user}
        />
      </main>
    </>
  );
}
