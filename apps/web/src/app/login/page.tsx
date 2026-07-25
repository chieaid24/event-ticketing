import { loadWebConfig } from "@event-ticketing/config";

import { AuthShell } from "../../components/auth-shell";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in | Event Ticketing Platform",
};

export default function LoginPage() {
  const config = loadWebConfig();

  return (
    <AuthShell
      heading="Sign in"
      summary="Use the email address and password you registered with."
    >
      <LoginForm apiBaseUrl={config.apiBaseUrl} />
      <p className="auth-alt">
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p className="auth-alt">
        New here? <a href="/register">Create an account</a>
      </p>
    </AuthShell>
  );
}
