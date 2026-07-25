import type { ReactNode } from "react";

export function SiteHeader({
  signedIn = false,
}: Readonly<{ signedIn?: boolean }> = {}): ReactNode {
  return (
    <header className="site-header">
      <a aria-label="Event Ticketing Platform home" className="brand" href="/">
        <span aria-hidden="true" className="brand__mark">
          ET
        </span>
        <span>Event Ticketing Platform</span>
      </a>
      <nav aria-label="Account" className="site-nav">
        {signedIn ? (
          <>
            <a href="/organizations">Organizations</a>
            <a className="site-nav__cta" href="/account">
              Account
            </a>
          </>
        ) : (
          <>
            <a href="/login">Sign in</a>
            <a className="site-nav__cta" href="/register">
              Create account
            </a>
          </>
        )}
      </nav>
    </header>
  );
}
