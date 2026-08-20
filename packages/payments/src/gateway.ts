export type PaymentProviderKind = "stripe" | "fake";

export interface CreatePaymentIntentInput {
  amountMinor: number;
  currency: string;
  // stable per-order key; retried call returns same intent
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  clientSecret: string;
  providerPaymentIntentId: string;
}

export interface CreateRefundInput {
  amountMinor: number;
  // stable per-refund key; retried call returns same refund
  idempotencyKey: string;
  metadata?: Record<string, string>;
  providerPaymentIntentId: string;
}

export interface RefundResult {
  providerRefundId: string;
  // true when provider reports refund already settled
  settled: boolean;
}

// provider side effects stay outside database transactions
export interface PaymentGateway {
  readonly provider: PaymentProviderKind;
  createPaymentIntent(
    input: CreatePaymentIntentInput
  ): Promise<PaymentIntentResult>;
  createRefund(input: CreateRefundInput): Promise<RefundResult>;
}

export class PaymentGatewayError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `Payment gateway failure: ${code}`);
    this.name = "PaymentGatewayError";
    this.code = code;
  }
}
