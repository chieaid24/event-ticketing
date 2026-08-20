"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { OrderSummary } from "@event-ticketing/contracts";

import { AuthApiError } from "../../../lib/auth-api";
import {
  fetchOrder,
  simulatePayment,
  startCheckout,
} from "../../../lib/checkout-api";
import { formatMoney } from "../../../lib/format";
import { StripePaymentPanel } from "./stripe-panel";

type CheckoutState =
  | { kind: "loading" }
  | { code: string; kind: "error"; message: string }
  | { kind: "ready"; order: OrderSummary };

function describeItem(item: OrderSummary["items"][number]): string {
  if (item.eventSeatId !== null) {
    return `${item.sectionName ?? ""} row ${item.rowLabel ?? "?"} seat ${item.seatLabel ?? "?"} (${item.ticketTypeName})`.trim();
  }
  return `${item.ticketTypeName} x ${String(item.quantity)}`;
}

function HoldCountdown({ expiresAt }: Readonly<{ expiresAt: string }>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const remainingMs = Date.parse(expiresAt) - now;
  if (remainingMs <= 0) {
    return (
      <p className="form-status form-status--error" role="alert">
        Your hold has expired. Payment may still succeed for a short grace
        period, but the inventory can be released at any moment. If payment
        succeeds after it is gone, you are refunded in full automatically.
      </p>
    );
  }
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1_000);
  return (
    <p aria-live="off" className="checkout-countdown" role="timer">
      Hold expires in{" "}
      <strong>
        {String(minutes)}:{seconds.toString().padStart(2, "0")}
      </strong>
    </p>
  );
}

export function CheckoutClient({
  apiBaseUrl,
  holdId,
}: Readonly<{ apiBaseUrl: string; holdId: string }>): ReactNode {
  const router = useRouter();
  const [state, setState] = useState<CheckoutState>({ kind: "loading" });
  const [paying, setPaying] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    startCheckout(apiBaseUrl, holdId)
      .then((order) => {
        if (!active) {
          return;
        }
        if (order.status !== "pending_payment") {
          router.replace(`/orders/${order.orderId}`);
          return;
        }
        setState({ kind: "ready", order });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof AuthApiError) {
          setState({ code: error.code, kind: "error", message: error.message });
          return;
        }
        setState({
          code: "unknown_error",
          kind: "error",
          message: "Starting checkout failed. Try again.",
        });
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, holdId, router]);

  const simulate = useCallback(
    async (outcome: "succeed" | "fail") => {
      if (state.kind !== "ready") {
        return;
      }
      setPaying(true);
      setPaymentNotice(null);
      try {
        await simulatePayment(apiBaseUrl, {
          orderId: state.order.orderId,
          outcome,
        });
        if (outcome === "succeed") {
          router.push(`/orders/${state.order.orderId}/processing`);
          return;
        }
        // wait for async failure processing then surface it
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const order = await fetchOrder(apiBaseUrl, state.order.orderId);
        setPaying(false);
        setPaymentNotice(
          order.payment.lastFailureCode
            ? `The simulated card was declined (${order.payment.lastFailureCode}). The order is still open; try paying again.`
            : "The simulated failure was recorded. The order is still open."
        );
      } catch (error) {
        setPaying(false);
        setPaymentNotice(
          error instanceof AuthApiError
            ? error.message
            : "The simulated payment failed to send. Try again."
        );
      }
    },
    [apiBaseUrl, router, state]
  );

  if (state.kind === "loading") {
    return (
      <p className="form-status" role="status">
        Preparing your order&hellip;
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <p className="form-status form-status--error" role="alert">
          {state.code === "hold_expired"
            ? "This hold has expired, so checkout cannot start. Availability may have changed since you selected."
            : state.message}
        </p>
        <p>
          <a className="button-quiet" href="/events">
            Back to events
          </a>
        </p>
      </>
    );
  }

  const { order } = state;
  return (
    <div className="checkout-layout">
      <section aria-labelledby="order-heading" className="account-section">
        <h2 id="order-heading">Order {order.publicNumber}</h2>
        <p className="field-hint">{order.eventTitle}</p>
        <table className="data-table checkout-lines">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th className="checkout-lines__amount" scope="col">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={`${item.ticketTypeId}:${item.eventSeatId ?? "ga"}`}>
                <td>{describeItem(item)}</td>
                <td className="checkout-lines__amount">
                  {formatMoney(
                    item.quantity * item.unitPriceMinor,
                    order.currency
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td>Fees</td>
              <td className="checkout-lines__amount">
                {formatMoney(order.feeMinor, order.currency)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="checkout-lines__amount">
                {formatMoney(order.totalMinor, order.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
        <HoldCountdown expiresAt={order.holdExpiresAt} />
      </section>

      <section aria-labelledby="payment-heading" className="account-section">
        <h2 id="payment-heading">Payment</h2>
        {paymentNotice && (
          <p className="form-status form-status--error" role="alert">
            {paymentNotice}
          </p>
        )}
        {!paymentNotice && order.payment.lastFailureCode && (
          <p className="form-status form-status--error" role="alert">
            A previous payment attempt failed ({order.payment.lastFailureCode}).
            You can try again.
          </p>
        )}
        {order.payment.provider === "stripe" ? (
          order.payment.clientSecret && order.payment.publishableKey ? (
            <StripePaymentPanel
              clientSecret={order.payment.clientSecret}
              publishableKey={order.payment.publishableKey}
              returnUrl={`${window.location.origin}/orders/${order.orderId}/processing`}
            />
          ) : (
            <p className="form-status form-status--error" role="alert">
              Payment is not configured. Contact support.
            </p>
          )
        ) : (
          <>
            <p className="field-hint">
              This environment uses a simulated payment provider. No real money
              moves; the outcome still flows through signed webhooks and
              server-side verification exactly like a live payment.
            </p>
            <div className="payment-simulation">
              <button
                className="button-primary"
                disabled={paying}
                onClick={() => void simulate("succeed")}
                type="button"
              >
                {paying
                  ? "Processing\u2026"
                  : `Pay ${formatMoney(order.totalMinor, order.currency)} (simulated)`}
              </button>
              <button
                className="button-quiet"
                disabled={paying}
                onClick={() => void simulate("fail")}
                type="button"
              >
                Simulate a declined card
              </button>
            </div>
          </>
        )}
        <p className="field-hint">
          Your order is confirmed only after the payment provider notifies our
          server. The browser never decides payment state.
        </p>
      </section>
    </div>
  );
}
