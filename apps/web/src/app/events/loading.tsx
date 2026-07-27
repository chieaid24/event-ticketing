import type { ReactNode } from "react";

import { SiteHeader } from "../../components/site-header";

export default function LoadingEvents(): ReactNode {
  return (
    <>
      <SiteHeader />
      <main aria-busy="true" className="auth-shell auth-shell--wide">
        <h1 className="auth-shell__heading">Discover events</h1>
        <p className="form-status" role="status">
          Loading events&hellip;
        </p>
      </main>
    </>
  );
}
