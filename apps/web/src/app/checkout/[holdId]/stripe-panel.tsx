"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState, type ReactNode } from "react";

function ConfirmForm({
  returnUrl,
}: Readonly<{ returnUrl: string }>): ReactNode {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    if (!stripe || !elements) {
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await stripe.confirmPayment({
      confirmParams: { return_url: returnUrl },
      elements,
    });
    // On success the browser redirects; reaching here means it did not.
    setSubmitting(false);
    setMessage(result.error.message ?? "The payment could not be confirmed.");
  };

  return (
    <form
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        void confirm();
      }}
    >
      <PaymentElement />
      {message && (
        <p className="form-status form-status--error" role="alert">
          {message}
        </p>
      )}
      <button
        className="button-primary"
        disabled={!stripe || submitting}
        type="submit"
      >
        {submitting ? "Confirming\u2026" : "Pay now"}
      </button>
    </form>
  );
}

export function StripePaymentPanel({
  clientSecret,
  publishableKey,
  returnUrl,
}: Readonly<{
  clientSecret: string;
  publishableKey: string;
  returnUrl: string;
}>): ReactNode {
  const stripePromise = useMemo<Promise<Stripe | null>>(
    () => loadStripe(publishableKey),
    [publishableKey]
  );

  return (
    <Elements options={{ clientSecret }} stripe={stripePromise}>
      <ConfirmForm returnUrl={returnUrl} />
    </Elements>
  );
}
