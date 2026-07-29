import { createFakePaymentGateway } from "./fake-gateway.js";
import { PaymentGatewayError, type PaymentGateway } from "./gateway.js";
import { createStripePaymentGateway } from "./stripe-gateway.js";

export * from "./events.js";
export * from "./fake-gateway.js";
export * from "./gateway.js";
export * from "./signature.js";
export * from "./stripe-gateway.js";

export interface PaymentGatewayConfig {
  provider: "stripe" | "fake";
  stripeSecretKey?: string;
}

export function createPaymentGateway(
  config: PaymentGatewayConfig
): PaymentGateway {
  if (config.provider === "stripe") {
    if (!config.stripeSecretKey) {
      throw new PaymentGatewayError(
        "missing_secret_key",
        "The stripe provider requires a configured secret key."
      );
    }
    return createStripePaymentGateway({ secretKey: config.stripeSecretKey });
  }
  return createFakePaymentGateway();
}
