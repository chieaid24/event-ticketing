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

// Argon2id hash of the synthetic development password "owner-password-dev".
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
      domainRecords: 3,
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
