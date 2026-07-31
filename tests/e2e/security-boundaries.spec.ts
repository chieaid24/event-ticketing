import { expect, request, test } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:4000";
const missingOrganizationId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const organizationId = "22222222-2222-4222-8222-222222222222";

test("live HTTP boundaries reject unauthenticated and forged requests", async () => {
  const anonymous = await request.newContext({ baseURL: apiBaseUrl });

  const protectedRead = await anonymous.get("/organizations");
  expect(protectedRead.status()).toBe(401);

  const forgedWebhook = await anonymous.post("/webhooks/payments", {
    data: { id: "evt_forged", type: "payment_intent.succeeded" },
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=forged",
    },
  });
  expect(forgedWebhook.status()).toBe(400);

  const oversized = await anonymous.post("/auth/register", {
    data: { email: "oversized@example.test", padding: "x".repeat(110_000) },
  });
  expect(oversized.status()).toBe(413);

  await anonymous.dispose();
});

test("live HTTP boundaries enforce CSRF, origins, validation, and tenant opacity", async () => {
  const authenticated = await request.newContext({ baseURL: apiBaseUrl });
  const login = await authenticated.post("/auth/login", {
    data: {
      email: "owner@example.test",
      password: "owner-password-dev",
    },
  });
  expect(login.status()).toBe(200);

  const cookies = (await authenticated.storageState()).cookies;
  const csrf = cookies.find((cookie) => cookie.name === "et_csrf")?.value;
  expect(csrf).toBeTruthy();

  const missingCsrf = await authenticated.patch(
    `/organizations/${missingOrganizationId}`,
    {
      data: { name: "Blocked without CSRF", version: 1 },
      headers: { origin: "http://127.0.0.1:3000" },
    }
  );
  expect(missingCsrf.status()).toBe(403);

  const untrustedOrigin = await authenticated.patch(
    `/organizations/${missingOrganizationId}`,
    {
      data: { name: "Blocked origin", version: 1 },
      headers: {
        origin: "https://attacker.example",
        "x-csrf-token": csrf!,
      },
    }
  );
  expect(untrustedOrigin.status()).toBe(403);

  const injection = await authenticated.patch(
    `/organizations/${organizationId}`,
    {
      data: {
        name: "Injection probe",
        version: "' OR 1=1; --",
      },
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": csrf!,
      },
    }
  );
  expect(injection.status()).toBe(400);

  const hiddenTenant = await authenticated.get(
    `/organizations/${missingOrganizationId}`
  );
  expect(hiddenTenant.status()).toBe(404);
  await expect(hiddenTenant.json()).resolves.toMatchObject({
    code: "organization_not_found",
  });

  await authenticated.dispose();
});
