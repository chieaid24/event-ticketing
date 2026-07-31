import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:4000";
const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const organizationId = "22222222-2222-4222-8222-222222222222";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("owner@example.test");
  await page.getByLabel("Password").fill("owner-password-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: "Your account" })
  ).toBeVisible();
}

test("organizer, purchase, ticket, scanner, refund, and analytics journey", async ({
  page,
}) => {
  await signIn(page);

  await page.goto(`/organizations/${organizationId}`);
  await expect(
    page.getByRole("heading", { name: "Example Test Box Office" })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage venues" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage events" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View operations" })
  ).toBeVisible();

  await page.goto(`/events/${eventId}`);
  await expect(
    page.getByRole("heading", { name: "Example Test Gala" })
  ).toBeVisible();
  await page.getByLabel("Standing Floor ticket quantity").fill("1");
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+$/);

  const paymentButton = page.getByRole("button", {
    name: /Pay .+ \(simulated\)/,
  });
  await expect(paymentButton).toBeVisible();
  await paymentButton.click();
  await expect(
    page.getByRole("heading", { name: "Order confirmed" })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);

  const orderUrl = page.url();
  const orderId = orderUrl.match(/\/orders\/([0-9a-f-]+)/)?.[1];
  expect(orderId).toBeTruthy();

  await page.getByRole("link", { name: "View your tickets" }).click();
  await expect(
    page.getByRole("heading", { name: "Your tickets" })
  ).toBeVisible();
  const ticketsResponse = await page.request.get(
    `${apiBaseUrl}/account/tickets`
  );
  expect(ticketsResponse.status()).toBe(200);
  const tickets = (await ticketsResponse.json()) as {
    tickets: { id: string; orderId: string; publicNumber: string }[];
  };
  const ticket = tickets.tickets.find(
    (candidate) => candidate.orderId === orderId
  );
  expect(ticket).toBeTruthy();
  const publicNumber = ticket!.publicNumber;

  await page.goto(`/tickets/${ticket!.id}`);
  await page.getByRole("button", { name: "Show QR code" }).click();
  await expect(
    page.getByRole("img", { name: /Admission QR code/ })
  ).toBeVisible();

  await page.goto(`/scan/${organizationId}/${eventId}`);
  const scanResult = page.getByRole("region", { name: "Scan result" });
  const manualNumber = page.getByLabel("Ticket number");
  await manualNumber.fill(publicNumber!);
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(scanResult.getByText("Admitted", { exact: true })).toBeVisible();

  await manualNumber.fill(publicNumber!);
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(
    scanResult.getByText("Already checked in", { exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "Reverse this check-in" }).click();
  await page.getByLabel("Reason").fill("Release verification reversal");
  await page.getByRole("button", { name: "Confirm reversal" }).click();
  await expect(
    scanResult.getByText("Check-in reversed", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(`Ticket ${publicNumber} is active again.`)
  ).toBeVisible();

  await page.goto(`/orders/${orderId!}`);
  await expect(
    page.getByRole("heading", { name: "Order confirmed" })
  ).toBeVisible();
  const orderResponse = await page.request.get(
    `${apiBaseUrl}/orders/${orderId!}`
  );
  const order = (await orderResponse.json()) as {
    items: { orderItemId: string }[];
  };
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "et_csrf"
  )?.value;
  expect(csrf).toBeTruthy();
  const refundResponse = await page.request.post(
    `${apiBaseUrl}/organizations/${organizationId}/orders/${orderId!}/refunds`,
    {
      data: {
        items: [{ orderItemId: order.items[0]!.orderItemId, quantity: 1 }],
        reason: "Release verification refund",
      },
      headers: {
        "idempotency-key": crypto.randomUUID(),
        origin: "http://127.0.0.1:3000",
        "x-csrf-token": csrf!,
      },
    }
  );
  expect(refundResponse.status()).toBe(202);

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${apiBaseUrl}/orders/${orderId!}`
        );
        return (await response.json()) as { status: string };
      },
      { timeout: 30_000 }
    )
    .toMatchObject({ status: "refunded" });

  await page.goto(`/scan/${organizationId}/${eventId}`);
  await page.getByLabel("Ticket number").fill(publicNumber!);
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(
    page
      .getByRole("region", { name: "Scan result" })
      .getByText("Refunded ticket", { exact: true })
  ).toBeVisible();

  await page.goto(`/organizations/${organizationId}/operations`);
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sales and refunds" })
  ).toBeVisible();
  await expect(page.getByText("Refunds completed")).toBeVisible();
  await expect(page.getByText("Duplicate scans")).toBeVisible();
});
