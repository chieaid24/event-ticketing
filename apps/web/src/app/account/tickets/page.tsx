import { redirect } from "next/navigation";

import type { TicketSummary } from "@event-ticketing/contracts";
import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../components/site-header";
import { fetchCurrentUser } from "../../../lib/auth-server";
import { formatEventInstant } from "../../../lib/format";
import { ticketStatusLabels } from "../../../lib/ticket-status";
import { fetchTickets } from "../../../lib/tickets-server";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { follow: false, index: false },
  title: "Your tickets | Event Ticketing Platform",
};

function seatDescription(ticket: TicketSummary): string {
  if (ticket.sectionName && ticket.seatLabel) {
    return `${ticket.sectionName}, row ${ticket.rowLabel ?? "?"}, seat ${ticket.seatLabel}`;
  }
  return "General admission";
}

export default async function TicketsPage() {
  const config = loadWebConfig();
  const me = await fetchCurrentUser(config.apiBaseUrl);
  if (!me) {
    redirect("/login");
  }
  const data = await fetchTickets(config.apiBaseUrl);
  const tickets = data?.tickets ?? [];

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <h1 className="auth-shell__heading">Your tickets</h1>
        <p className="auth-shell__summary">
          Every admission credential from your paid orders. Open a ticket to see
          its details and reveal a scannable code at the gate.
        </p>
        {tickets.length === 0 ? (
          <p className="form-status" role="status">
            You have no tickets yet. Tickets appear here once an order is paid.
          </p>
        ) : (
          <ul aria-label="Your tickets" className="ticket-list">
            {tickets.map((ticket) => (
              <li className="ticket-list__item" key={ticket.id}>
                <div className="ticket-list__body">
                  <p className="ticket-list__title">
                    <a href={`/tickets/${ticket.id}`}>{ticket.eventTitle}</a>
                  </p>
                  <p className="ticket-list__meta">
                    {ticket.eventStartsAt
                      ? formatEventInstant(
                          ticket.eventStartsAt,
                          ticket.eventTimezone
                        )
                      : "Date to be announced"}{" "}
                    &middot; {ticket.venueName}
                  </p>
                  <p className="ticket-list__meta">
                    {seatDescription(ticket)} &middot; Ticket{" "}
                    {ticket.publicNumber}
                  </p>
                </div>
                <span className="ticket-status" data-status={ticket.status}>
                  {ticketStatusLabels[ticket.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
