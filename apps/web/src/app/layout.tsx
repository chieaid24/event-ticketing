import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-serif-4";
import "./globals.css";

import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
