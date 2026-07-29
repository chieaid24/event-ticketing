import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../components/site-header";
import { fetchCurrentUser } from "../../../lib/auth-server";
import { OrderStatusClient } from "./order-status-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Order | Event Ticketing Platform" };

type PageProps = Readonly<{ params: Promise<{ orderId: string }> }>;

export default async function OrderPage({ params }: PageProps) {
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
        {me ? (
          <OrderStatusClient apiBaseUrl={config.apiBaseUrl} orderId={orderId} />
        ) : (
          <>
            <h1 className="auth-shell__heading">Order</h1>
            <p className="form-status" role="status">
              <a href="/login">Sign in</a> to see this order.
            </p>
          </>
        )}
      </main>
    </>
  );
}
