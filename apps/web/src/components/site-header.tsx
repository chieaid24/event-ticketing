import type { ReactNode } from "react";

export function SiteHeader(): ReactNode {
  return (
    <header className="site-header">
      <a aria-label="Event Ticketing Platform home" className="brand" href="/">
        <span aria-hidden="true" className="brand__mark">
          ET
        </span>
        <span>Event Ticketing Platform</span>
      </a>
      <nav aria-label="Account" className="site-nav">
        <a href="/login">Sign in</a>
        <a className="site-nav__cta" href="/register">
          Create account
        </a>
      </nav>
    </header>
  );
}
