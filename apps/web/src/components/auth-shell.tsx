import type { ReactNode } from "react";

import { SiteHeader } from "./site-header";

export function AuthShell({
  children,
  heading,
  summary,
}: Readonly<{
  children: ReactNode;
  heading: string;
  summary: string;
}>): ReactNode {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader />
      <main className="auth-shell" id="main-content">
        <h1 className="auth-shell__heading">{heading}</h1>
        <p className="auth-shell__summary">{summary}</p>
        {children}
      </main>
    </>
  );
}
