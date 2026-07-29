"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AuthApiError } from "../../../../lib/auth-api";
import { fetchOrder } from "../../../../lib/checkout-api";

const POLL_INTERVAL_MS = 2_500;
const GIVE_UP_AFTER_MS = 3 * 60_000;

type ProcessingState =
  | { kind: "waiting" }
  | { holdId: string; kind: "failed"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "timeout" };

/**
 * Polls the authoritative order until verified backend processing settles it.
 * The redirect back from the payment provider proves nothing; only the order
 * status transition does.
 */
export function ProcessingClient({
  apiBaseUrl,
  orderId,
}: Readonly<{ apiBaseUrl: string; orderId: string }>): ReactNode {
  const router = useRouter();
  const [state, setState] = useState<ProcessingState>({ kind: "waiting" });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async (): Promise<void> => {
      try {
        const order = await fetchOrder(apiBaseUrl, orderId);
        if (!active) {
          return;
        }
        if (order.status !== "pending_payment") {
          router.replace(`/orders/${orderId}`);
          return;
        }
        if (order.payment.lastFailureCode !== null) {
          setState({
            holdId: order.holdId,
            kind: "failed",
            reason: order.payment.lastFailureCode,
          });
          return;
        }
      } catch (error) {
        if (!active) {
          return;
        }
        if (error instanceof AuthApiError && error.code === "order_not_found") {
          setState({ kind: "error", message: "The order does not exist." });
          return;
        }
        // Transient errors keep polling until the deadline.
      }
      if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
        setState({ kind: "timeout" });
        return;
      }
      timer = setTimeout(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [apiBaseUrl, orderId, router]);

  if (state.kind === "failed") {
    return (
      <>
        <p className="form-status form-status--error" role="alert">
          The payment did not go through ({state.reason}). Your order is still
          open and nothing was charged.
        </p>
        <p>
          <a className="button-primary" href={`/checkout/${state.holdId}`}>
            Try paying again
          </a>
        </p>
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="form-status form-status--error" role="alert">
        {state.message}
      </p>
    );
  }

  if (state.kind === "timeout") {
    return (
      <>
        <p className="form-status" role="status">
          The payment is still being confirmed. This can take a moment; check
          the order page for the final state.
        </p>
        <p>
          <a className="button-primary" href={`/orders/${orderId}`}>
            View order
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <p aria-live="polite" className="form-status" role="status">
        Waiting for the payment provider to confirm&hellip; This page updates
        automatically.
      </p>
      <p className="field-hint">
        Your order is confirmed only after our server verifies the provider's
        signed notification. Do not refresh or pay again.
      </p>
    </>
  );
}
