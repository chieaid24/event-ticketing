import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../components/site-header";
import { fetchCurrentUser } from "../../../lib/auth-server";
import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Checkout | Event Ticketing Platform" };

type PageProps = Readonly<{ params: Promise<{ holdId: string }> }>;

export default async function CheckoutPage({ params }: PageProps) {
  const config = loadWebConfig();
  const { holdId } = await params;
  const me = await fetchCurrentUser(config.apiBaseUrl);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn={Boolean(me)} />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <h1 className="auth-shell__heading">Checkout</h1>
        {me ? (
          <CheckoutClient apiBaseUrl={config.apiBaseUrl} holdId={holdId} />
        ) : (
          <p className="form-status" role="status">
            <a href="/login">Sign in</a> to finish checking out. Your selection
            is held only after checkout starts.
          </p>
        )}
      </main>
    </>
  );
}
