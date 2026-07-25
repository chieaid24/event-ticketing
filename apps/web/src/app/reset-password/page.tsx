import { loadWebConfig } from "@event-ticketing/config";

import { AuthShell } from "../../components/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Choose a new password | Event Ticketing Platform",
};

export default async function ResetPasswordPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[]>> }>) {
  const config = loadWebConfig();
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <AuthShell
      heading="Choose a new password"
      summary="Signing in on every device requires the new password afterwards."
    >
      <ResetPasswordForm apiBaseUrl={config.apiBaseUrl} token={token} />
    </AuthShell>
  );
}
