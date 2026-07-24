# Event Ticketing Platform Ubiquitous Language

Use these terms in code, API contracts, issues, and documentation.

| Term          | Meaning                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| User          | A person with one platform identity.                                                     |
| Customer      | A user who discovers events, creates holds, and owns orders or tickets.                  |
| Organization  | The tenant that owns venues, events, inventory, and organizer data.                      |
| Membership    | A user's role and status inside one organization.                                        |
| Organizer     | A user acting through an organization membership.                                        |
| Venue         | A reusable place and layout template owned by an organization.                           |
| Venue seat    | A seat definition in a venue template.                                                   |
| Event         | A scheduled, organization-owned offering with sale and lifecycle rules.                  |
| Event seat    | An immutable event-specific snapshot of a sellable venue seat.                           |
| Ticket type   | A price and inventory configuration for assigned or general admission.                   |
| Inventory     | Event seats or general-admission capacity that can be held or sold.                      |
| Hold          | A short-lived, actor-owned reservation of inventory at a server-calculated price.        |
| Order         | The immutable commercial record created from one hold.                                   |
| Payment       | A provider transaction associated with an order.                                         |
| Ticket        | One issued admission credential for one purchased unit.                                  |
| Scan          | An append-only record of a ticket validation attempt.                                    |
| Check-in      | The atomic transition that accepts an active ticket once.                                |
| Refund        | A server-calculated reversal against eligible order items and payment value.             |
| Outbox event  | A durable request for asynchronous side effects committed with domain state.             |
| Waiting room  | A Redis-coordinated admission layer that limits access to inventory endpoints.           |
| Actor scope   | The authenticated user or anonymous session boundary used for ownership and idempotency. |
| Public number | A nonsecret identifier safe to show for an order or ticket.                              |
| QR token      | A high-entropy bearer secret whose hash, not raw value, is stored.                       |

Do not use "account" when `User`, `Organization`, or `Membership` is the precise
term. Do not call a browser selection a hold until the hold transaction commits.
Do not call a payment successful until verified backend processing finalizes it.
