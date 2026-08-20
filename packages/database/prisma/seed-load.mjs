// isolated idempotent k6 dataset
import pg from "pg";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";
const databaseUrl = process.env["DATABASE_URL"] ?? localDatabaseUrl;

const parsedUrl = new URL(databaseUrl);
const schema = parsedUrl.searchParams.get("schema") ?? "public";

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
  throw new Error("DATABASE_URL contains an invalid schema name.");
}

const client = new pg.Client({ connectionString: databaseUrl });

// local synthetic buyer password hash
const buyerPasswordHash =
  "$argon2id$v=19$m=19456,p=1,t=2$mKwK8cARnS8akUQlAFsR7g" +
  "$BCp9DbDRNw28oOP5Yf5HaXl/hY6RDnQIYhS8vIcwt3c";

const BUYER_COUNT = 250;
const SEAT_ROWS = 10;
const SEATS_PER_ROW = 10;
const GA_CAPACITY = 60_000;
// short expiry visible after load runs but safe mid-purchase
const HOLD_DURATION_SECONDS = 180;

const organizationId = "dddddddd-dddd-4ddd-8ddd-000000000001";
const organizerUserId = "dddddddd-dddd-4ddd-8ddd-000000000002";
const membershipId = "dddddddd-dddd-4ddd-8ddd-000000000003";
const venueId = "dddddddd-dddd-4ddd-8ddd-000000000010";
const assignedSectionId = "dddddddd-dddd-4ddd-8ddd-000000000011";
const gaSectionId = "dddddddd-dddd-4ddd-8ddd-000000000012";
const loadEventId = "dddddddd-dddd-4ddd-8ddd-000000000100";
const assignedTicketTypeId = "dddddddd-dddd-4ddd-8ddd-000000000201";
const gaTicketTypeId = "dddddddd-dddd-4ddd-8ddd-000000000202";

function loadSuffixId(offset) {
  return `dddddddd-dddd-4ddd-8ddd-${offset.toString(16).padStart(12, "0")}`;
}

function buyerEmail(index) {
  return `load-buyer-${String(index).padStart(4, "0")}@example.test`;
}

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(`SET LOCAL search_path TO "${schema}"`);

  await client.query(
    `
      INSERT INTO "users" (
        "id", "email", "password_hash", "platform_role", "status",
        "email_verified_at"
      )
      VALUES ($1, $2, $3, 'customer', 'active', $4)
      ON CONFLICT ("id") DO UPDATE SET
        "email" = EXCLUDED."email",
        "password_hash" = EXCLUDED."password_hash",
        "status" = EXCLUDED."status",
        "email_verified_at" = EXCLUDED."email_verified_at"
    `,
    [
      organizerUserId,
      "load-organizer@example.test",
      buyerPasswordHash,
      "2026-01-01T00:00:00.000Z",
    ]
  );
  for (let index = 1; index <= BUYER_COUNT; index += 1) {
    await client.query(
      `
        INSERT INTO "users" (
          "id", "email", "password_hash", "platform_role", "status",
          "email_verified_at"
        )
        VALUES ($1, $2, $3, 'customer', 'active', $4)
        ON CONFLICT ("id") DO UPDATE SET
          "email" = EXCLUDED."email",
          "password_hash" = EXCLUDED."password_hash",
          "status" = EXCLUDED."status",
          "email_verified_at" = EXCLUDED."email_verified_at"
      `,
      [
        loadSuffixId(0x1000 + index),
        buyerEmail(index),
        buyerPasswordHash,
        "2026-01-01T00:00:00.000Z",
      ]
    );
  }

  await client.query(
    `
      INSERT INTO "organizations" ("id", "name", "slug")
      VALUES ($1, $2, $3)
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "slug" = EXCLUDED."slug"
    `,
    [organizationId, "Load Test Promotions", "load-test-promotions"]
  );
  await client.query(
    `
      INSERT INTO "organization_memberships" (
        "id", "organization_id", "user_id", "role", "status", "joined_at"
      )
      VALUES ($1, $2, $3, 'owner', 'active', $4)
      ON CONFLICT ("id") DO UPDATE SET
        "organization_id" = EXCLUDED."organization_id",
        "user_id" = EXCLUDED."user_id",
        "role" = EXCLUDED."role",
        "status" = EXCLUDED."status"
    `,
    [membershipId, organizationId, organizerUserId, "2026-01-01T00:00:00.000Z"]
  );
  await client.query(
    `
      INSERT INTO "venues" ("id", "organization_id", "name", "description")
      VALUES ($1, $2, $3, $4)
      ON CONFLICT ("id") DO UPDATE SET
        "organization_id" = EXCLUDED."organization_id",
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description"
    `,
    [
      venueId,
      organizationId,
      "Load Test Arena",
      "Synthetic venue for purchase-flow load tests.",
    ]
  );
  const sections = [
    [assignedSectionId, "Load Stalls", "assigned", null, 0],
    [gaSectionId, "Load Floor", "general_admission", GA_CAPACITY, 1],
  ];
  for (const [id, name, kind, gaCapacity, position] of sections) {
    await client.query(
      `
        INSERT INTO "venue_sections"
          ("id", "venue_id", "name", "kind", "ga_capacity", "position")
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ("id") DO UPDATE SET
          "venue_id" = EXCLUDED."venue_id",
          "name" = EXCLUDED."name",
          "kind" = EXCLUDED."kind",
          "ga_capacity" = EXCLUDED."ga_capacity",
          "position" = EXCLUDED."position"
      `,
      [id, venueId, name, kind, gaCapacity, position]
    );
  }
  await client.query(
    `
      INSERT INTO "events" (
        "id", "organization_id", "venue_id", "title", "description",
        "status", "timezone", "currency", "starts_at", "ends_at",
        "sales_start_at", "sales_end_at", "refund_policy", "published_at",
        "hold_duration_seconds", "waiting_room_enabled"
      )
      VALUES ($1, $2, $3, $4, $5, 'published', $6, 'USD',
              $7, $8, $9, $10, $11, $12, $13, false)
      ON CONFLICT ("id") DO UPDATE SET
        "organization_id" = EXCLUDED."organization_id",
        "venue_id" = EXCLUDED."venue_id",
        "title" = EXCLUDED."title",
        "description" = EXCLUDED."description",
        "status" = EXCLUDED."status",
        "sales_start_at" = EXCLUDED."sales_start_at",
        "sales_end_at" = EXCLUDED."sales_end_at",
        "hold_duration_seconds" = EXCLUDED."hold_duration_seconds",
        "waiting_room_enabled" = EXCLUDED."waiting_room_enabled"
    `,
    [
      loadEventId,
      organizationId,
      venueId,
      "Load Test Arena Night",
      "Synthetic published event reserved for purchase-flow load tests.",
      "America/Toronto",
      "2027-06-01T00:00:00.000Z",
      "2027-06-01T03:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2027-06-01T00:00:00.000Z",
      "Full refund up to 24 hours before the event starts.",
      "2026-01-02T00:00:00.000Z",
      HOLD_DURATION_SECONDS,
    ]
  );
  const ticketTypes = [
    [
      assignedTicketTypeId,
      "Load Stalls Reserved",
      "assigned",
      "Load Stalls",
      2500,
      250,
      null,
      0,
    ],
    [
      gaTicketTypeId,
      "Load Floor",
      "general_admission",
      "Load Floor",
      1800,
      150,
      GA_CAPACITY,
      1,
    ],
  ];
  for (const [
    id,
    name,
    kind,
    sectionName,
    priceMinor,
    feeMinor,
    capacity,
    position,
  ] of ticketTypes) {
    await client.query(
      `
        INSERT INTO "ticket_types"
          ("id", "event_id", "name", "kind", "section_name",
           "price_minor", "fee_minor", "capacity", "position")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT ("id") DO UPDATE SET
          "name" = EXCLUDED."name",
          "kind" = EXCLUDED."kind",
          "section_name" = EXCLUDED."section_name",
          "price_minor" = EXCLUDED."price_minor",
          "fee_minor" = EXCLUDED."fee_minor",
          "capacity" = EXCLUDED."capacity",
          "position" = EXCLUDED."position"
      `,
      [
        id,
        loadEventId,
        name,
        kind,
        sectionName,
        priceMinor,
        feeMinor,
        capacity,
        position,
      ]
    );
  }
  // shared pool; conflict keeps sold state
  let seatIndex = 0;
  for (let row = 0; row < SEAT_ROWS; row += 1) {
    const rowLabel = String.fromCharCode(65 + row);
    for (let seat = 1; seat <= SEATS_PER_ROW; seat += 1) {
      await client.query(
        `
          INSERT INTO "event_seats"
            ("id", "event_id", "ticket_type_id", "section_name", "row_label",
             "seat_label", "x", "y", "accessible", "companion", "price_minor",
             "status")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, false, $9, 'available')
          ON CONFLICT ("id") DO UPDATE SET
            "section_name" = EXCLUDED."section_name",
            "row_label" = EXCLUDED."row_label",
            "seat_label" = EXCLUDED."seat_label",
            "x" = EXCLUDED."x",
            "y" = EXCLUDED."y",
            "price_minor" = EXCLUDED."price_minor"
        `,
        [
          loadSuffixId(0x400 + seatIndex),
          loadEventId,
          assignedTicketTypeId,
          "Load Stalls",
          rowLabel,
          String(seat),
          seat * 10,
          (row + 1) * 10,
          2500,
        ]
      );
      seatIndex += 1;
    }
  }
  await client.query("COMMIT");
  process.stdout.write(
    `${JSON.stringify({
      buyers: BUYER_COUNT,
      event: "database.seed_load.completed",
      eventId: loadEventId,
      gaCapacity: GA_CAPACITY,
      holdDurationSeconds: HOLD_DURATION_SECONDS,
      seats: SEAT_ROWS * SEATS_PER_ROW,
    })}\n`
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
