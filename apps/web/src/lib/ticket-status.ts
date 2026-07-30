import type { TicketStatus } from "@event-ticketing/contracts";

export const ticketStatusLabels: Record<TicketStatus, string> = {
  active: "Active",
  checked_in: "Checked in",
  refunded: "Refunded",
  void: "Void",
};

export const ticketStatusDescriptions: Record<TicketStatus, string> = {
  active: "This ticket admits one at the gate.",
  checked_in: "This ticket has been used for entry.",
  refunded: "This ticket was refunded and cannot be used for entry.",
  void: "This ticket is void and cannot be used for entry.",
};
