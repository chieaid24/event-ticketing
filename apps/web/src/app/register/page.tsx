import { loadWebConfig } from "@event-ticketing/config";

import { AuthShell } from "../../components/auth-shell";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create account | Event Ticketing Platform",
};

export default function RegisterPage() {
  const config = loadWebConfig();

  return (
    <AuthShell
      heading="Create your account"
      summary="Register with your email address. A verification link confirms it before you can sign in."
    >
      <RegisterForm apiBaseUrl={config.apiBaseUrl} />
      <p className="auth-alt">
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </AuthShell>
  );
}
