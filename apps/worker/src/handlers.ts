import type { OutboxHandler } from "./outbox-processor.js";
import { OutboxHandlerError } from "./outbox-processor.js";

export const organizationCreatedHandler: OutboxHandler = async (event) => {
  if (
    typeof event.payload !== "object" ||
    event.payload === null ||
    !("organizationId" in event.payload) ||
    typeof event.payload.organizationId !== "string" ||
    event.payload.organizationId !== event.aggregateId
  ) {
    throw new OutboxHandlerError("invalid_event_payload");
  }
};

// missing handlers dead-letter events
export const eventPublishedHandler: OutboxHandler = async (event) => {
  if (
    typeof event.payload !== "object" ||
    event.payload === null ||
    !("eventId" in event.payload) ||
    typeof event.payload.eventId !== "string" ||
    event.payload.eventId !== event.aggregateId
  ) {
    throw new OutboxHandlerError("invalid_event_payload");
  }
};

export const workerHandlers: Readonly<Record<string, OutboxHandler>> = {
  "event.published": eventPublishedHandler,
  "organization.created": organizationCreatedHandler,
};
