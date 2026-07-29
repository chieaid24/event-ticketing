import { notFound } from "next/navigation";

import { loadWebConfig } from "@event-ticketing/config";

import { SiteHeader } from "../../../components/site-header";
import { fetchCurrentUser } from "../../../lib/auth-server";
import { fetchPublicEventDetail } from "../../../lib/discovery-server";
import { formatEventInstant, formatMoney } from "../../../lib/format";
import { AvailabilityPanels } from "./availability-panels";

export const dynamic = "force-dynamic";

type PageProps = Readonly<{ params: Promise<{ eventId: string }> }>;

export async function generateMetadata({ params }: PageProps) {
  const config = loadWebConfig();
  const { eventId } = await params;
  const result = await fetchPublicEventDetail(config.apiBaseUrl, eventId);
  return {
    title:
      result.kind === "ok"
        ? `${result.data.event.title} | Event Ticketing Platform`
        : "Event | Event Ticketing Platform",
  };
}

function salesWindowCopy(
  salesStartAt: string,
  salesEndAt: string,
  timezone: string
): { onSale: boolean; text: string } {
  const now = Date.now();
  if (now < Date.parse(salesStartAt)) {
    return {
      onSale: false,
      text: `Sales open ${formatEventInstant(salesStartAt, timezone)}`,
    };
  }
  if (now >= Date.parse(salesEndAt)) {
    return {
      onSale: false,
      text: `Sales ended ${formatEventInstant(salesEndAt, timezone)}`,
    };
  }
  return {
    onSale: true,
    text: `On sale until ${formatEventInstant(salesEndAt, timezone)}`,
  };
}

const kindLabels = {
  assigned: "Assigned seating",
  general_admission: "General admission",
} as const;

export default async function PublicEventPage({ params }: PageProps) {
  const config = loadWebConfig();
  const { eventId } = await params;
  const [me, result] = await Promise.all([
    fetchCurrentUser(config.apiBaseUrl),
    fetchPublicEventDetail(config.apiBaseUrl, eventId),
  ]);

  if (result.kind === "not_found") {
    notFound();
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader signedIn={Boolean(me)} />
      <main className="auth-shell auth-shell--wide" id="main-content">
        <p className="auth-shell__summary">
          <a href="/events">All events</a>
        </p>
        {result.kind === "error" ? (
          <>
            <h1 className="auth-shell__heading">Event unavailable</h1>
            <p className="form-status form-status--error" role="alert">
              Loading this event failed.{" "}
              <a href={`/events/${encodeURIComponent(eventId)}`}>Try again</a>.
            </p>
          </>
        ) : (
          <EventDetail
            apiBaseUrl={config.apiBaseUrl}
            detail={result.data}
            signedIn={Boolean(me)}
          />
        )}
      </main>
    </>
  );
}

function EventDetail({
  apiBaseUrl,
  detail,
  signedIn,
}: Readonly<{
  apiBaseUrl: string;
  signedIn: boolean;
  detail: {
    event: {
      currency: string;
      description: string | null;
      endsAt: string;
      id: string;
      refundPolicy: string | null;
      salesEndAt: string;
      salesStartAt: string;
      startsAt: string;
      timezone: string;
      title: string;
    };
    ticketTypes: readonly {
      feeMinor: number;
      id: string;
      kind: "assigned" | "general_admission";
      name: string;
      priceMinor: number;
      sectionName: string;
    }[];
    venue: { name: string };
  };
}>) {
  const { event, ticketTypes, venue } = detail;
  const sales = salesWindowCopy(
    event.salesStartAt,
    event.salesEndAt,
    event.timezone
  );

  return (
    <>
      <p className="eyebrow">{venue.name}</p>
      <h1 className="auth-shell__heading">{event.title}</h1>
      {event.description && (
        <p className="auth-shell__summary">{event.description}</p>
      )}

      <dl className="account-details">
        <div>
          <dt>Starts</dt>
          <dd>{formatEventInstant(event.startsAt, event.timezone)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>{formatEventInstant(event.endsAt, event.timezone)}</dd>
        </div>
        <div>
          <dt>Ticket sales</dt>
          <dd>{sales.text}</dd>
        </div>
        {event.refundPolicy && (
          <div>
            <dt>Refund policy</dt>
            <dd>{event.refundPolicy}</dd>
          </div>
        )}
      </dl>

      <section
        aria-labelledby="ticket-types-heading"
        className="account-section"
      >
        <h2 id="ticket-types-heading">Tickets</h2>
        <table className="data-table">
          <caption className="sr-only">Ticket types for {event.title}</caption>
          <thead>
            <tr>
              <th scope="col">Ticket</th>
              <th scope="col">Section</th>
              <th scope="col">Admission</th>
              <th scope="col">Price</th>
              <th scope="col">Fee</th>
            </tr>
          </thead>
          <tbody>
            {ticketTypes.map((ticketType) => (
              <tr key={ticketType.id}>
                <th scope="row">{ticketType.name}</th>
                <td>{ticketType.sectionName}</td>
                <td>{kindLabels[ticketType.kind]}</td>
                <td>{formatMoney(ticketType.priceMinor, event.currency)}</td>
                <td>{formatMoney(ticketType.feeMinor, event.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <AvailabilityPanels
        apiBaseUrl={apiBaseUrl}
        currency={event.currency}
        eventId={event.id}
        salesOpen={sales.onSale}
        signedIn={signedIn}
      />
    </>
  );
}
