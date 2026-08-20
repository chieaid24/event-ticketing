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

// local synthetic owner password hash
const ownerPasswordHash =
  "$argon2id$v=19$m=19456,p=1,t=2$mKwK8cARnS8akUQlAFsR7g" +
  "$BCp9DbDRNw28oOP5Yf5HaXl/hY6RDnQIYhS8vIcwt3c";

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  await client.query(
    `
      INSERT INTO "users" (
        "id",
        "email",
        "password_hash",
        "platform_role",
        "status",
        "email_verified_at"
      )
      VALUES ($1, $2, $3, 'customer', 'active', $4)
      ON CONFLICT ("id") DO UPDATE SET
        "email" = EXCLUDED."email",
        "password_hash" = EXCLUDED."password_hash",
        "platform_role" = EXCLUDED."platform_role",
        "status" = EXCLUDED."status",
        "email_verified_at" = EXCLUDED."email_verified_at"
    `,
    [
      "11111111-1111-4111-8111-111111111111",
      "owner@example.test",
      ownerPasswordHash,
      "2026-01-01T00:00:00.000Z",
    ]
  );
  await client.query(
    `
      INSERT INTO "organizations" ("id", "name", "slug")
      VALUES ($1, $2, $3)
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "slug" = EXCLUDED."slug"
    `,
    [
      "22222222-2222-4222-8222-222222222222",
      "Example Test Box Office",
      "example-test-box-office",
    ]
  );
  await client.query(
    `
      INSERT INTO "organization_memberships" (
        "id",
        "organization_id",
        "user_id",
        "role",
        "status",
        "joined_at"
      )
      VALUES ($1, $2, $3, 'owner', 'active', $4)
      ON CONFLICT ("id") DO UPDATE SET
        "organization_id" = EXCLUDED."organization_id",
        "user_id" = EXCLUDED."user_id",
        "role" = EXCLUDED."role",
        "status" = EXCLUDED."status",
        "joined_at" = EXCLUDED."joined_at"
    `,
    [
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
      "2026-01-01T00:00:00.000Z",
    ]
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
      "66666666-6666-4666-8666-666666666666",
      "22222222-2222-4222-8222-222222222222",
      "Example Test Hall",
      "Synthetic venue template for development.",
    ]
  );
  const seedSections = [
    ["77777777-7777-4777-8777-777777777771", "Stalls", "assigned", null, 0],
    [
      "77777777-7777-4777-8777-777777777772",
      "Standing Floor",
      "general_admission",
      250,
      1,
    ],
  ];
  for (const [id, name, kind, gaCapacity, position] of seedSections) {
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
      [
        id,
        "66666666-6666-4666-8666-666666666666",
        name,
        kind,
        gaCapacity,
        position,
      ]
    );
  }
  const seedRows = [
    ["88888888-8888-4888-8888-888888888881", "A", 0],
    ["88888888-8888-4888-8888-888888888882", "B", 1],
  ];
  for (const [id, label, position] of seedRows) {
    await client.query(
      `
        INSERT INTO "venue_rows" ("id", "section_id", "label", "position")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("id") DO UPDATE SET
          "section_id" = EXCLUDED."section_id",
          "label" = EXCLUDED."label",
          "position" = EXCLUDED."position"
      `,
      [id, "77777777-7777-4777-8777-777777777771", label, position]
    );
  }
  const seedSeats = [
    ["99999999-9999-4999-8999-999999999901", 0, "1", 0, 0, false, false],
    ["99999999-9999-4999-8999-999999999902", 0, "2", 1, 0, false, false],
    ["99999999-9999-4999-8999-999999999903", 0, "3", 3, 0, true, false],
    ["99999999-9999-4999-8999-999999999904", 0, "4", 4, 0, false, true],
    ["99999999-9999-4999-8999-999999999905", 1, "1", 0, 1, false, false],
    ["99999999-9999-4999-8999-999999999906", 1, "2", 1, 1, false, false],
    ["99999999-9999-4999-8999-999999999907", 1, "3", 3, 1, false, false],
    ["99999999-9999-4999-8999-999999999908", 1, "4", 4, 1, false, false],
  ];
  for (const [id, rowIndex, label, x, y, accessible, companion] of seedSeats) {
    await client.query(
      `
        INSERT INTO "venue_seats"
          ("id", "row_id", "label", "x", "y", "accessible", "companion")
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT ("id") DO UPDATE SET
          "row_id" = EXCLUDED."row_id",
          "label" = EXCLUDED."label",
          "x" = EXCLUDED."x",
          "y" = EXCLUDED."y",
          "accessible" = EXCLUDED."accessible",
          "companion" = EXCLUDED."companion"
      `,
      [id, seedRows[rowIndex][0], label, x, y, accessible, companion]
    );
  }
  await client.query(
    `
      INSERT INTO "events" (
        "id",
        "organization_id",
        "venue_id",
        "title",
        "description",
        "status",
        "timezone",
        "currency",
        "starts_at",
        "ends_at",
        "sales_start_at",
        "sales_end_at",
        "refund_policy",
        "published_at"
      )
      VALUES ($1, $2, $3, $4, $5, 'published', $6, 'USD',
              $7, $8, $9, $10, $11, $12)
      ON CONFLICT ("id") DO UPDATE SET
        "organization_id" = EXCLUDED."organization_id",
        "venue_id" = EXCLUDED."venue_id",
        "title" = EXCLUDED."title",
        "description" = EXCLUDED."description",
        "status" = EXCLUDED."status",
        "timezone" = EXCLUDED."timezone",
        "currency" = EXCLUDED."currency",
        "starts_at" = EXCLUDED."starts_at",
        "ends_at" = EXCLUDED."ends_at",
        "sales_start_at" = EXCLUDED."sales_start_at",
        "sales_end_at" = EXCLUDED."sales_end_at",
        "refund_policy" = EXCLUDED."refund_policy",
        "published_at" = EXCLUDED."published_at"
    `,
    [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "22222222-2222-4222-8222-222222222222",
      "66666666-6666-4666-8666-666666666666",
      "Example Test Gala",
      "A synthetic published event for development and demos.",
      "America/Toronto",
      "2027-03-01T00:00:00.000Z",
      "2027-03-01T03:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2027-03-01T00:00:00.000Z",
      "Full refund up to 24 hours before the event starts.",
      "2026-01-02T00:00:00.000Z",
    ]
  );
  const seedTicketTypes = [
    [
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      "Stalls Reserved",
      "assigned",
      "Stalls",
      2500,
      250,
      null,
      0,
    ],
    [
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      "Standing Floor",
      "general_admission",
      "Standing Floor",
      1800,
      150,
      200,
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
  ] of seedTicketTypes) {
    await client.query(
      `
        INSERT INTO "ticket_types"
          ("id", "event_id", "name", "kind", "section_name",
           "price_minor", "fee_minor", "capacity", "position")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT ("id") DO UPDATE SET
          "event_id" = EXCLUDED."event_id",
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
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
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
  // preset sold and blocked seats for availability states
  const seedEventSeats = [
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      "A",
      "1",
      0,
      0,
      false,
      false,
      "available",
    ],
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
      "A",
      "2",
      1,
      0,
      false,
      false,
      "sold",
    ],
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      "A",
      "3",
      3,
      0,
      true,
      false,
      "available",
    ],
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc4",
      "A",
      "4",
      4,
      0,
      false,
      true,
      "available",
    ],
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc5",
      "B",
      "1",
      0,
      1,
      false,
      false,
      "available",
    ],
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc6",
      "B",
      "2",
      1,
      1,
      false,
      false,
      "available",
    ],
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc7",
      "B",
      "3",
      3,
      1,
      false,
      false,
      "available",
    ],
    [
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc8",
      "B",
      "4",
      4,
      1,
      false,
      false,
      "blocked",
    ],
  ];
  for (const [
    id,
    rowLabel,
    seatLabel,
    x,
    y,
    accessible,
    companion,
    status,
  ] of seedEventSeats) {
    await client.query(
      `
        INSERT INTO "event_seats"
          ("id", "event_id", "ticket_type_id", "section_name", "row_label",
           "seat_label", "x", "y", "accessible", "companion", "price_minor",
           "status")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT ("id") DO UPDATE SET
          "event_id" = EXCLUDED."event_id",
          "ticket_type_id" = EXCLUDED."ticket_type_id",
          "section_name" = EXCLUDED."section_name",
          "row_label" = EXCLUDED."row_label",
          "seat_label" = EXCLUDED."seat_label",
          "x" = EXCLUDED."x",
          "y" = EXCLUDED."y",
          "accessible" = EXCLUDED."accessible",
          "companion" = EXCLUDED."companion",
          "price_minor" = EXCLUDED."price_minor",
          "status" = EXCLUDED."status"
      `,
      [
        id,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        "Stalls",
        rowLabel,
        seatLabel,
        x,
        y,
        accessible,
        companion,
        2500,
        status,
      ]
    );
  }
  await client.query(
    `
      INSERT INTO "outbox_events" (
        "topic",
        "payload",
        "aggregate_type",
        "aggregate_id",
        "deduplication_key",
        "available_at"
      )
      VALUES ($1, $2::jsonb, $3, $4, $5, $6)
      ON CONFLICT ("deduplication_key") DO NOTHING
    `,
    [
      "organization.created",
      JSON.stringify({
        organizationId: "22222222-2222-4222-8222-222222222222",
      }),
      "organization",
      "22222222-2222-4222-8222-222222222222",
      "seed:organization.created:22222222-2222-4222-8222-222222222222",
      "2026-01-01T00:00:00.000Z",
    ]
  );
  await client.query("COMMIT");
  process.stdout.write(
    `${JSON.stringify({
      domainRecords: 27,
      event: "database.seed.completed",
      outboxEvents: 1,
    })}\n`
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
