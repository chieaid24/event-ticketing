import {
  refundSummarySchema,
  type CreateRefundRequest,
  type RefundSummary,
} from "@event-ticketing/contracts";

import { requestJson } from "./auth-api";

export async function createCustomerRefund(
  apiBaseUrl: string,
  orderId: string,
  input: CreateRefundRequest,
  idempotencyKey: string
): Promise<RefundSummary> {
  return refundSummarySchema.parse(
    await requestJson(apiBaseUrl, `/orders/${orderId}/refunds`, {
      body: input,
      csrf: true,
      headers: { "idempotency-key": idempotencyKey },
      method: "POST",
    })
  );
}
