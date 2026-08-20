// Post-run PostgreSQL invariant verification for the k6 purchase-flow load
// scenario. PostgreSQL is the source of truth: every check reads the tables
// directly and reports its violation count explicitly, including zeros.
// Exits non-zero on any violation.
import pg from "pg";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";
const databaseUrl = process.env["DATABASE_URL"] ?? localDatabaseUrl;
const eventId =
  process.env["EVENT_ID"] ?? "dddddddd-dddd-4ddd-8ddd-000000000100";
// Grace for the worker's expiry sweep; an active hold this far past expiry
// means release is broken, not just lagging.
const EXPIRY_SWEEP_GRACE_SECONDS = 120;

const client = new pg.Client({ connectionString: databaseUrl });

async function count(query, parameters) {
  const result = await client.query(query, parameters);
  return Number(result.rows[0]?.count ?? 0);
}

try {
  await client.connect();

  // 1. Oversells, from the authoritative counters.
  const oversellsByCounter = await count(
    `
      SELECT count(*)::int AS count FROM "ticket_types"
      WHERE "event_id" = $1 AND "capacity" IS NOT NULL
        AND "reserved_quantity" + "sold_quantity" > "capacity"
    `,
    [eventId]
  );

  // 1b. Oversells recounted from rows, independent of the counters.
  const oversellsByRows = await count(
    `
      SELECT count(*)::int AS count FROM "ticket_types" tt
      WHERE tt."event_id" = $1 AND tt."capacity" IS NOT NULL
        AND (
          SELECT count(*) FROM "tickets" t
          WHERE t."ticket_type_id" = tt."id"
            AND t."status" IN ('active', 'checked_in')
        ) + (
          SELECT COALESCE(sum(hi."quantity"), 0) FROM "hold_items" hi
          JOIN "holds" h ON h."id" = hi."hold_id"
          WHERE hi."ticket_type_id" = tt."id"
            AND h."status" IN ('active', 'checkout_started')
        ) > tt."capacity"
    `,
    [eventId]
  );

  // 2. Double-booked seats: more than one live ticket on one seat.
  const doubleBookedSeats = await count(
    `
      SELECT count(*)::int AS count FROM (
        SELECT t."event_seat_id" FROM "tickets" t
        JOIN "event_seats" s ON s."id" = t."event_seat_id"
        WHERE s."event_id" = $1 AND t."status" IN ('active', 'checked_in')
        GROUP BY t."event_seat_id"
        HAVING count(*) > 1
      ) conflicts
    `,
    [eventId]
  );

  // 2b. Sold seats must carry exactly one live ticket.
  const soldSeatTicketMismatches = await count(
    `
      SELECT count(*)::int AS count FROM "event_seats" s
      WHERE s."event_id" = $1 AND s."status" = 'sold'
        AND (
          SELECT count(*) FROM "tickets" t
          WHERE t."event_seat_id" = s."id"
            AND t."status" IN ('active', 'checked_in')
        ) <> 1
    `,
    [eventId]
  );

  // 3. Paid-order integrity: one succeeded payment carrying the
  // server-computed total, and one ticket per purchased unit.
  const paidOrderViolations = await count(
    `
      SELECT count(*)::int AS count FROM "orders" o
      WHERE o."event_id" = $1 AND o."status" = 'paid'
        AND NOT (
          (
            SELECT count(*) FROM "payments" p
            WHERE p."order_id" = o."id" AND p."status" = 'succeeded'
              AND p."amount_minor" = o."total_minor"
              AND upper(p."currency") = upper(o."currency")
          ) = 1
          AND o."subtotal_minor" = (
            SELECT COALESCE(sum(oi."quantity" * oi."unit_price_minor"), -1)
            FROM "order_items" oi WHERE oi."order_id" = o."id"
          )
          AND o."total_minor" = o."subtotal_minor" + o."fee_minor"
          AND (
            SELECT count(*) FROM "tickets" t
            WHERE t."order_id" = o."id"
              AND t."status" IN ('active', 'checked_in')
          ) = (
            SELECT COALESCE(sum(oi."quantity"), -1)
            FROM "order_items" oi WHERE oi."order_id" = o."id"
          )
        )
    `,
    [eventId]
  );

  // 4. Expired holds released inventory.
  const unreleasedExpiredHolds = await count(
    `
      SELECT count(*)::int AS count FROM "holds"
      WHERE "event_id" = $1 AND "status" = 'active'
        AND "expires_at" + make_interval(secs => $2) <= CURRENT_TIMESTAMP
    `,
    [eventId, EXPIRY_SWEEP_GRACE_SECONDS]
  );
  const seatsHeldByDeadHolds = await count(
    `
      SELECT count(*)::int AS count FROM "event_seats" s
      WHERE s."event_id" = $1 AND s."status" = 'held'
        AND NOT EXISTS (
          SELECT 1 FROM "holds" h
          WHERE h."id" = s."hold_id"
            AND h."status" IN ('active', 'checkout_started')
        )
    `,
    [eventId]
  );
  const gaReservedDrift = await count(
    `
      SELECT count(*)::int AS count FROM "ticket_types" tt
      WHERE tt."event_id" = $1 AND tt."kind" = 'general_admission'
        AND tt."reserved_quantity" <> (
          SELECT COALESCE(sum(hi."quantity"), 0) FROM "hold_items" hi
          JOIN "holds" h ON h."id" = hi."hold_id"
          WHERE hi."ticket_type_id" = tt."id"
            AND h."status" IN ('active', 'checkout_started')
        )
    `,
    [eventId]
  );

  const totals = await client.query(
    `
      SELECT
        (SELECT count(*) FROM "orders"
          WHERE "event_id" = $1 AND "status" = 'paid')::int AS paid_orders,
        (SELECT count(*) FROM "orders"
          WHERE "event_id" = $1
            AND "status" = 'payment_conflict')::int AS conflict_orders,
        (SELECT count(*) FROM "tickets" t
          JOIN "orders" o ON o."id" = t."order_id"
          WHERE o."event_id" = $1
            AND t."status" IN ('active', 'checked_in'))::int AS tickets,
        (SELECT COALESCE(sum("sold_quantity"), 0) FROM "ticket_types"
          WHERE "event_id" = $1)::int AS sold_quantity,
        (SELECT COALESCE(sum("reserved_quantity"), 0) FROM "ticket_types"
          WHERE "event_id" = $1)::int AS reserved_quantity,
        (SELECT count(*) FROM "event_seats"
          WHERE "event_id" = $1 AND "status" = 'sold')::int AS seats_sold
    `,
    [eventId]
  );
  const summary = totals.rows[0];

  const violations =
    oversellsByCounter +
    oversellsByRows +
    doubleBookedSeats +
    soldSeatTicketMismatches +
    paidOrderViolations +
    unreleasedExpiredHolds +
    seatsHeldByDeadHolds +
    gaReservedDrift;

  process.stdout.write(
    `${JSON.stringify({
      doubleBookedSeats,
      event: "load.invariants.completed",
      eventId,
      gaReservedDrift,
      orders: {
        paid: summary.paid_orders,
        paymentConflict: summary.conflict_orders,
      },
      oversellsByCounter,
      oversellsByRows,
      paidOrderViolations,
      reservedQuantity: summary.reserved_quantity,
      seatsHeldByDeadHolds,
      seatsSold: summary.seats_sold,
      soldQuantity: summary.sold_quantity,
      soldSeatTicketMismatches,
      ticketsIssued: summary.tickets,
      unreleasedExpiredHolds,
      violations,
    })}\n`
  );

  if (violations > 0) {
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
