"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { OrderSummary } from "@event-ticketing/contracts";

import { AuthApiError } from "../../../lib/auth-api";
import { fetchOrder } from "../../../lib/checkout-api";
import { formatMoney } from "../../../lib/format";

type OrderState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; order: OrderSummary };

function describeItem(item: OrderSummary["items"][number]): string {
  if (item.eventSeatId !== null) {
    return `${item.sectionName ?? ""} row ${item.rowLabel ?? "?"} seat ${item.seatLabel ?? "?"} (${item.ticketTypeName})`.trim();
  }
  return `${item.ticketTypeName} x ${String(item.quantity)}`;
}

const statusCopy = {
  paid: {
    heading: "Order confirmed",
    tone: "form-status form-status--success",
  },
  payment_conflict: {
    heading: "Payment refunded",
    tone: "form-status form-status--error",
  },
  pending_payment: {
    heading: "Payment in progress",
    tone: "form-status",
  },
  refunded: {
    heading: "Payment refunded",
    tone: "form-status",
  },
} as const;

function statusMessage(order: OrderSummary): string {
  switch (order.status) {
    case "paid":
      return `Payment confirmed. ${String(order.ticketCount)} ticket${
        order.ticketCount === 1 ? "" : "s"
      } issued for ${order.eventTitle}.`;
    case "pending_payment":
      return "This order is awaiting payment confirmation.";
    case "payment_conflict":
      return "Your payment succeeded after the reserved inventory was released, so a full refund was started automatically. No tickets were issued and you will not be charged.";
    case "refunded":
      return "This order was fully refunded. No tickets remain active.";
  }
}

export function OrderStatusClient({
  apiBaseUrl,
  orderId,
}: Readonly<{ apiBaseUrl: string; orderId: string }>): ReactNode {
  const [state, setState] = useState<OrderState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    fetchOrder(apiBaseUrl, orderId)
      .then((order) => {
        if (active) {
          setState({ kind: "ready", order });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            kind: "error",
            message:
              error instanceof AuthApiError
                ? error.message
                : "Loading the order failed. Try again.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, orderId]);

  if (state.kind === "loading") {
    return (
      <>
        <h1 className="auth-shell__heading">Order</h1>
        <p className="form-status" role="status">
          Loading the order&hellip;
        </p>
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <h1 className="auth-shell__heading">Order</h1>
        <p className="form-status form-status--error" role="alert">
          {state.message}
        </p>
      </>
    );
  }

  const { order } = state;
  const copy = statusCopy[order.status];
  return (
    <>
      <h1 className="auth-shell__heading">{copy.heading}</h1>
      <p className="auth-shell__summary">
        Order {order.publicNumber} for {order.eventTitle}
      </p>
      <p className={copy.tone} role="status">
        {statusMessage(order)}
      </p>
      {order.status === "pending_payment" && (
        <p>
          <a
            className="button-primary"
            href={`/orders/${order.orderId}/processing`}
          >
            Check payment progress
          </a>{" "}
          <a className="button-quiet" href={`/checkout/${order.holdId}`}>
            Return to payment
          </a>
        </p>
      )}
      <section
        aria-labelledby="order-lines-heading"
        className="account-section"
      >
        <h2 id="order-lines-heading">Summary</h2>
        <table className="data-table checkout-lines">
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
        {order.status === "paid" && (
          <p className="field-hint">
            Your tickets are ready.{" "}
            <a href="/account/tickets">View your tickets</a> to see each one and
            reveal a scannable code at the gate.
          </p>
        )}
      </section>
    </>
  );
}
