import { StatusBadge } from "@event-ticketing/ui";

import { loadWebConfig } from "@event-ticketing/config";

import { fetchApiStatus } from "../lib/api-status";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = loadWebConfig();
  const apiStatus = await fetchApiStatus(config.apiBaseUrl);
  const apiAvailable = apiStatus.kind === "available";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <a
          aria-label="Event Ticketing Platform home"
          className="brand"
          href="/"
        >
          <span aria-hidden="true" className="brand__mark">
            ET
          </span>
          <span>Event Ticketing Platform</span>
        </a>
        <span className="release-label">Foundation status</span>
      </header>

      <main className="page-shell" id="main-content">
        <section aria-labelledby="page-title" className="intro">
          <p className="eyebrow">Service readiness</p>
          <h1 id="page-title">A dependable core for every ticket.</h1>
          <p className="intro__summary">
            The platform keeps commercial decisions behind a typed API. This
            page verifies that the web application can reach that boundary
            before inventory and checkout workflows are enabled.
          </p>
        </section>

        <section aria-labelledby="api-heading" className="status-panel">
          <div className="status-panel__heading">
            <div>
              <p className="section-label">Application service</p>
              <h2 id="api-heading">API connection</h2>
            </div>
            <StatusBadge status={apiAvailable ? "available" : "unavailable"}>
              {apiAvailable ? "Connected" : "Unavailable"}
            </StatusBadge>
          </div>

          <dl className="status-details">
            <div>
              <dt>Service</dt>
              <dd>
                {apiAvailable ? apiStatus.data.service.toUpperCase() : "API"}
              </dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{apiAvailable ? `v${apiStatus.data.version}` : "Unknown"}</dd>
            </div>
            <div>
              <dt>Response</dt>
              <dd>{apiAvailable ? "Typed and valid" : "Not available"}</dd>
            </div>
          </dl>

          <p aria-live="polite" className="status-message">
            {apiAvailable
              ? "The API returned the shared status contract."
              : "The web application could not verify the API status. Start all services and retry."}
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <p>PostgreSQL remains authoritative for inventory and orders.</p>
      </footer>
    </>
  );
}
