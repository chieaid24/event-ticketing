export type PaymentProviderKind = "stripe" | "fake";

export interface CreatePaymentIntentInput {
  amountMinor: number;
  currency: string;
  /** Stable per-order key; a retried call returns the same logical intent. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  clientSecret: string;
  providerPaymentIntentId: string;
}

export interface CreateRefundInput {
  amountMinor: number;
  /** Stable per-refund key; a retried call returns the same logical refund. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
  providerPaymentIntentId: string;
}

export interface RefundResult {
  providerRefundId: string;
  /** True when the provider reports the refund as settled already. */
  settled: boolean;
}

/**
 * The provider boundary for payment side effects. Implementations never run
 * inside a database transaction and never decide commercial state; verified
 * webhook processing does.
 */
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
