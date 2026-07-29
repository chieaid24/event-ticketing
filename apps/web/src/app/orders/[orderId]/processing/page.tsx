import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../../components/site-header";
import { fetchCurrentUser } from "../../../../lib/auth-server";
import { ProcessingClient } from "./processing-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Processing payment | Event Ticketing Platform",
};

type PageProps = Readonly<{ params: Promise<{ orderId: string }> }>;

export default async function ProcessingPage({ params }: PageProps) {
  const config = loadWebConfig();
  const { orderId } = await params;
  const me = await fetchCurrentUser(config.apiBaseUrl);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn={Boolean(me)} />
      <main className="auth-shell" id="main-content">
        <h1 className="auth-shell__heading">Processing your payment</h1>
        {me ? (
          <ProcessingClient apiBaseUrl={config.apiBaseUrl} orderId={orderId} />
        ) : (
          <p className="form-status" role="status">
            <a href="/login">Sign in</a> to see this order.
          </p>
        )}
      </main>
    </>
  );
}
