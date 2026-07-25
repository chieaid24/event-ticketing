import { loadWebConfig } from "@event-ticketing/config";

import { AuthShell } from "../../components/auth-shell";
import { VerifyEmailClient } from "./verify-email-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify email | Event Ticketing Platform",
};

export default async function VerifyEmailPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[]>> }>) {
  const config = loadWebConfig();
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <AuthShell
      heading="Verify your email"
      summary="This confirms the address on your new account."
    >
      <VerifyEmailClient apiBaseUrl={config.apiBaseUrl} token={token} />
    </AuthShell>
  );
}
