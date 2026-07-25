import { loadWebConfig } from "@event-ticketing/config";

import { AuthShell } from "../../components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Forgot password | Event Ticketing Platform",
};

export default function ForgotPasswordPage() {
  const config = loadWebConfig();

  return (
    <AuthShell
      heading="Reset your password"
      summary="Enter your email address. If an account exists, a reset link arrives shortly."
    >
      <ForgotPasswordForm apiBaseUrl={config.apiBaseUrl} />
      <p className="auth-alt">
        Remembered it? <a href="/login">Sign in</a>
      </p>
    </AuthShell>
  );
}
