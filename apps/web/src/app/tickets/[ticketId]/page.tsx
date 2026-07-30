import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../components/site-header";
import { fetchCurrentUser } from "../../../lib/auth-server";
import { formatEventInstant } from "../../../lib/format";
import {
  ticketStatusDescriptions,
  ticketStatusLabels,
} from "../../../lib/ticket-status";
import { fetchTicket } from "../../../lib/tickets-server";
import { TicketQrClient } from "./ticket-qr-client";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { follow: false, index: false },
  title: "Ticket | Event Ticketing Platform",
};

type PageProps = Readonly<{ params: Promise<{ ticketId: string }> }>;

export default async function TicketPage({ params }: PageProps) {
  const config = loadWebConfig();
  const { ticketId } = await params;
  const me = await fetchCurrentUser(config.apiBaseUrl);

  if (!me) {
    return (
      <>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <main className="auth-shell" id="main-content">
          <h1 className="auth-shell__heading">Ticket</h1>
          <p className="form-status" role="status">
            <a href="/login">Sign in</a> to see this ticket.
          </p>
        </main>
      </>
    );
  }

  const ticket = await fetchTicket(config.apiBaseUrl, ticketId);

  if (!ticket) {
    return (
      <>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader signedIn />
        <main className="auth-shell" id="main-content">
          <h1 className="auth-shell__heading">Ticket not found</h1>
          <p className="form-status" role="status">
            This ticket does not exist or is not on your account.{" "}
            <a href="/account/tickets">Back to your tickets</a>.
          </p>
        </main>
      </>
    );
  }

  const isAssigned = Boolean(ticket.sectionName && ticket.seatLabel);
  const startsAt = ticket.eventStartsAt
    ? formatEventInstant(ticket.eventStartsAt, ticket.eventTimezone)
    : "To be announced";
  const endsAt = ticket.eventEndsAt
    ? formatEventInstant(ticket.eventEndsAt, ticket.eventTimezone)
    : null;

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <p className="eyebrow">Ticket {ticket.publicNumber}</p>
        <h1 className="auth-shell__heading">{ticket.eventTitle}</h1>
        <p className="auth-shell__summary">
          <span className="ticket-status" data-status={ticket.status}>
            {ticketStatusLabels[ticket.status]}
          </span>{" "}
          {ticketStatusDescriptions[ticket.status]}
        </p>

        <section
          aria-labelledby="ticket-code-heading"
          className="account-section"
        >
          <h2 id="ticket-code-heading">Entry code</h2>
          <TicketQrClient
            active={ticket.status === "active"}
            apiBaseUrl={config.apiBaseUrl}
            ticketId={ticket.id}
          />
        </section>

        <section
          aria-labelledby="ticket-details-heading"
          className="account-section"
        >
          <h2 id="ticket-details-heading">Event details</h2>
          <dl className="account-details">
            <div>
              <dt>Starts</dt>
              <dd>{startsAt}</dd>
            </div>
            {endsAt ? (
              <div>
                <dt>Ends</dt>
                <dd>{endsAt}</dd>
              </div>
            ) : null}
            <div>
              <dt>Time zone</dt>
              <dd>{ticket.eventTimezone}</dd>
            </div>
            <div>
              <dt>Venue</dt>
              <dd>{ticket.venueName}</dd>
            </div>
            {ticket.venueDescription ? (
              <div>
                <dt>Access</dt>
                <dd>{ticket.venueDescription}</dd>
              </div>
            ) : null}
            <div>
              <dt>Admission</dt>
              <dd>
                {isAssigned
                  ? `${ticket.sectionName}, row ${ticket.rowLabel ?? "?"}, seat ${ticket.seatLabel}`
                  : `General admission (${ticket.ticketTypeName})`}
                {ticket.seatAccessible ? (
                  <>
                    {" "}
                    <span className="ticket-accessible">
                      Accessible seating
                    </span>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>
                <a href={`/orders/${ticket.orderId}`}>
                  {ticket.orderPublicNumber}
                </a>
              </dd>
            </div>
          </dl>
        </section>
      </main>
    </>
  );
}
