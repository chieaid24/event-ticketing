import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-serif-4";
import "./globals.css";

import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  description:
    "Event Ticketing Platform service status and product foundation.",
  title: "Event Ticketing Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV !== "production" && (
          // Dev-only: neutralize the Next.js 16 RSC perf-measure crash
          // (negative timestamp). Upstream: vercel/next.js#86060
          <Script id="dev-perf-measure-guard" strategy="beforeInteractive">
            {`(function(){try{if(!self.performance||!performance.measure)return;var m=performance.measure.bind(performance);performance.measure=function(){try{return m.apply(performance,arguments)}catch(e){if(e&&/negative time stamp/.test(String(e.message)))return;throw e}}}catch(e){}})();`}
          </Script>
        )}
        {children}
      </body>
    </html>
  );
}
