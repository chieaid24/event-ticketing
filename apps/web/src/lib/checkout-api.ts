import {
  apiErrorSchema,
  createAssignedSeatHoldResponseSchema,
  createGeneralAdmissionHoldResponseSchema,
  orderSummarySchema,
  webhookAckSchema,
  type CreateAssignedSeatHoldResponse,
  type CreateGeneralAdmissionHoldResponse,
  type OrderSummary,
  type WebhookAck,
} from "@event-ticketing/contracts";

import { AuthApiError, requestJson } from "./auth-api";

export async function createAssignedSeatHold(
  apiBaseUrl: string,
  input: { eventId: string; seatIds: string[] },
  idempotencyKey: string
): Promise<CreateAssignedSeatHoldResponse> {
  return createAssignedSeatHoldResponseSchema.parse(
    await requestJson(apiBaseUrl, "/holds/assigned", {
      body: input,
      csrf: true,
      headers: { "idempotency-key": idempotencyKey },
      method: "POST",
    })
  );
}

export async function createGeneralAdmissionHold(
  apiBaseUrl: string,
  input: {
    eventId: string;
    items: { quantity: number; ticketTypeId: string }[];
  },
  idempotencyKey: string
): Promise<CreateGeneralAdmissionHoldResponse> {
  return createGeneralAdmissionHoldResponseSchema.parse(
    await requestJson(apiBaseUrl, "/holds/general-admission", {
      body: input,
      csrf: true,
      headers: { "idempotency-key": idempotencyKey },
      method: "POST",
    })
  );
}

export async function startCheckout(
  apiBaseUrl: string,
  holdId: string
): Promise<OrderSummary> {
  return orderSummarySchema.parse(
    await requestJson(apiBaseUrl, "/checkout", {
      body: { holdId },
      csrf: true,
      method: "POST",
    })
  );
}

export async function fetchOrder(
  apiBaseUrl: string,
  orderId: string
): Promise<OrderSummary> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/orders/${orderId}`, {
      cache: "no-store",
      credentials: "include",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AuthApiError(
      "network_error",
      "The service could not be reached. Try again."
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    throw new AuthApiError(
      parsed.success ? parsed.data.code : "unknown_error",
      parsed.success ? parsed.data.message : "The request failed. Try again."
    );
  }
  return orderSummarySchema.parse(payload);
}

export async function simulatePayment(
  apiBaseUrl: string,
  input: { orderId: string; outcome: "succeed" | "fail" }
): Promise<WebhookAck> {
  return webhookAckSchema.parse(
    await requestJson(apiBaseUrl, "/payments/simulate", {
      body: input,
      csrf: true,
      method: "POST",
    })
  );
}
