"use client";

import QRCode from "qrcode";
import { useState, type ReactNode } from "react";

import { AuthApiError } from "../../../lib/auth-api";
import { revealTicketQr } from "../../../lib/tickets-api";

type QrState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; dataUrl: string; publicNumber: string };

export function TicketQrClient({
  active,
  apiBaseUrl,
  ticketId,
}: Readonly<{
  active: boolean;
  apiBaseUrl: string;
  ticketId: string;
}>): ReactNode {
  const [state, setState] = useState<QrState>({ kind: "idle" });

  if (!active) {
    return (
      <p className="form-status" role="status">
        This ticket is not active, so it has no scannable code.
      </p>
    );
  }

  async function reveal(): Promise<void> {
    setState({ kind: "loading" });
    try {
      const revealed = await revealTicketQr(apiBaseUrl, ticketId);
      // render the bearer only as pixels
      const dataUrl = await QRCode.toDataURL(revealed.token, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
      });
      setState({
        dataUrl,
        kind: "ready",
        publicNumber: revealed.publicNumber,
      });
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof AuthApiError
            ? error.message
            : "Generating your QR code failed. Try again.",
      });
    }
  }

  if (state.kind === "ready") {
    return (
      <div className="ticket-qr">
        <div className="ticket-qr__frame">
          <img
            alt={`Admission QR code for ticket ${state.publicNumber}`}
            className="ticket-qr__image"
            height={320}
            src={state.dataUrl}
            width={320}
          />
        </div>
        <p className="field-hint" role="status">
          Show this code at the gate. Revealing a new code replaces this one, so
          any earlier code stops working.
        </p>
        <button
          className="button-quiet"
          onClick={() => {
            void reveal();
          }}
          type="button"
        >
          Refresh code
        </button>
      </div>
    );
  }

  return (
    <div className="ticket-qr">
      <p className="account-section-lead">
        Your QR code is generated on demand and rotates each time you reveal it,
        so a leaked screenshot cannot be reused.
      </p>
      {state.kind === "error" ? (
        <p className="form-status form-status--error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button
        className="button-primary"
        disabled={state.kind === "loading"}
        onClick={() => {
          void reveal();
        }}
        type="button"
      >
        {state.kind === "loading" ? "Generating…" : "Show QR code"}
      </button>
    </div>
  );
}
