import { describe, expect, it, vi } from "vitest";

const { fetchAuthenticatedMock } = vi.hoisted(() => ({
  fetchAuthenticatedMock: vi.fn(),
}));

vi.mock("./auth-server", () => ({
  fetchAuthenticated: fetchAuthenticatedMock,
}));

import { fetchTicket, fetchTickets } from "./tickets-server";

const ticket = {
  eventEndsAt: "2027-03-01T03:00:00.000Z",
  eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  eventStartsAt: "2027-03-01T00:00:00.000Z",
  eventStatus: "published",
  eventTimezone: "America/Toronto",
  eventTitle: "Example Test Gala",
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  orderId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  orderPublicNumber: "ET-0123456789AB",
  publicNumber: "TK-ABCDEF012345",
  qrRotatedAt: null,
  rowLabel: "C",
  seatAccessible: false,
  seatLabel: "12",
  sectionName: "Orchestra",
  status: "active",
  ticketTypeKind: "assigned",
  ticketTypeName: "Reserved",
  venueDescription: "Enter via the north doors.",
  venueName: "Grand Hall",
};

describe("fetchTickets", () => {
  it("requests the account-scoped path and parses the list", async () => {
    fetchAuthenticatedMock.mockResolvedValue({ tickets: [ticket] });

    await expect(fetchTickets("https://api.example.test")).resolves.toEqual({
      tickets: [ticket],
    });
    expect(fetchAuthenticatedMock).toHaveBeenCalledWith(
      "https://api.example.test",
      "/account/tickets"
    );
  });

  it("returns null for an unexpected shape", async () => {
    fetchAuthenticatedMock.mockResolvedValue({
      tickets: [{ ...ticket, qrTokenHash: "leaked" }],
    });

    await expect(fetchTickets("https://api.example.test")).resolves.toBeNull();
  });

  it("returns null when the request was not authenticated", async () => {
    fetchAuthenticatedMock.mockResolvedValue(null);

    await expect(fetchTickets("https://api.example.test")).resolves.toBeNull();
  });
});

describe("fetchTicket", () => {
  it("requests the ticket by id and parses it", async () => {
    fetchAuthenticatedMock.mockResolvedValue(ticket);

    await expect(
      fetchTicket("https://api.example.test", ticket.id)
    ).resolves.toEqual(ticket);
    expect(fetchAuthenticatedMock).toHaveBeenCalledWith(
      "https://api.example.test",
      `/tickets/${ticket.id}`
    );
  });

  it("returns null when the ticket is missing", async () => {
    fetchAuthenticatedMock.mockResolvedValue(null);

    await expect(
      fetchTicket("https://api.example.test", ticket.id)
    ).resolves.toBeNull();
  });
});
