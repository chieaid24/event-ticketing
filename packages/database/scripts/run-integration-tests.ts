import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import pg from "pg";

import {
  consumeAuthToken,
  createAuthToken,
  createSession,
  createUser,
  generateAuthSecret,
  hashAuthSecret,
  listActiveSessions,
  markUserEmailVerified,
  revokeSessionById,
  revokeUserSessions,
} from "../src/auth.js";
import {
  fetchAvailabilitySeats,
  fetchGeneralAdmissionCapacity,
  fetchPublicTicketTypes,
  findPublishedEventById,
  listPublishedEvents,
} from "../src/discovery.js";
import {
  claimEventVersion,
  fetchSectionSeats,
  fetchTicketTypes,
  fetchVenueSectionSummaries,
  insertEvent,
  insertEventSeats,
  markEventPublished,
  replaceTicketTypes,
  updateEventDraft,
} from "../src/events.js";
import {
  clearHoldExpiry,
  holdExpiryKey,
  mirrorHoldExpiry,
  readHoldExpiry,
} from "../src/hold-availability-mirror.js";
import {
  cancelHold,
  createGeneralAdmissionHold,
  expireDueHolds,
  expireHold,
  fetchGeneralAdmissionAvailability,
  finalizeGeneralAdmissionHold,
} from "../src/holds.js";
import { insertAuditLog } from "../src/organizations.js";
import {
  createDatabasePool,
  createOutboxRepository,
  enqueueOutboxEvent,
  withDatabaseTransaction,
} from "../src/outbox.js";
import {
  claimVenueVersion,
  deleteVenueById,
  fetchVenueLayout,
  findVenueById,
  insertVenue,
  listVenuesForOrganization,
  replaceVenueLayout,
} from "../src/venues.js";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";
const baseDatabaseUrl = process.env["DATABASE_URL"] ?? localDatabaseUrl;
const redisUrl = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
const scope = randomUUID().replaceAll("-", "");
const schema = `test_${scope}`;
const redisPrefix = `test:${scope}:`;
const scopedDatabaseUrl = new URL(baseDatabaseUrl);
scopedDatabaseUrl.searchParams.set("schema", schema);
const adminDatabaseUrl = new URL(baseDatabaseUrl);
adminDatabaseUrl.searchParams.delete("schema");

const admin = new pg.Client({ connectionString: adminDatabaseUrl.toString() });
const redis = new Redis(redisUrl, {
  connectTimeout: 2_000,
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 0,
});
let adminConnected = false;

function runPrisma(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("prisma", [...args, "--config", "prisma.config.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: scopedDatabaseUrl.toString(),
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Prisma exited with ${
            signal ? `signal ${signal}` : `code ${String(code)}`
          }.`
        )
      );
    });
  });
}

async function deleteRedisScope(): Promise<void> {
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${redisPrefix}*`,
      "COUNT",
      100
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE SCHEMA "${schema}"`);

  await runPrisma(["migrate", "deploy"]);
  await runPrisma(["db", "seed"]);
  await runPrisma(["db", "seed"]);

  const pool = createDatabasePool(scopedDatabaseUrl.toString(), {
    maxConnections: 12,
  });
  const outbox = createOutboxRepository(pool);

  try {
    const baseline = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM "users") AS "users",
        (SELECT count(*)::int FROM "organizations") AS "organizations",
        (
          SELECT count(*)::int FROM "organization_memberships"
        ) AS "memberships",
        (SELECT count(*)::int FROM "outbox_events") AS "outbox_events",
        (SELECT count(*)::int FROM "venues") AS "venues",
        (SELECT count(*)::int FROM "venue_sections") AS "venue_sections",
        (SELECT count(*)::int FROM "venue_rows") AS "venue_rows",
        (SELECT count(*)::int FROM "venue_seats") AS "venue_seats",
        (SELECT count(*)::int FROM "events") AS "events",
        (SELECT count(*)::int FROM "ticket_types") AS "ticket_types",
        (SELECT count(*)::int FROM "event_seats") AS "event_seats"
    `);

    assert.deepEqual(baseline.rows, [
      {
        event_seats: 8,
        events: 1,
        memberships: 1,
        organizations: 1,
        outbox_events: 1,
        ticket_types: 2,
        users: 1,
        venue_rows: 2,
        venue_seats: 8,
        venue_sections: 2,
        venues: 1,
      },
    ]);

    const rollbackId = "44444444-4444-4444-8444-444444444444";
    await assert.rejects(
      withDatabaseTransaction(pool, async (transaction) => {
        await transaction.query(
          `
            INSERT INTO "organizations" ("id", "name", "slug")
            VALUES ($1, $2, $3)
          `,
          [rollbackId, "Rollback Test Organization", "rollback-test"]
        );
        await enqueueOutboxEvent(transaction, {
          aggregateId: rollbackId,
          aggregateType: "organization",
          deduplicationKey: `organization.created:${rollbackId}`,
          payload: { organizationId: rollbackId },
          topic: "organization.created",
        });
        throw new Error("rollback probe");
      }),
      /rollback probe/
    );
    const rolledBack = await pool.query(
      `
        SELECT
          (SELECT count(*)::int FROM "organizations" WHERE "id" = $1) AS "domain",
          (
            SELECT count(*)::int
            FROM "outbox_events"
            WHERE "aggregate_id" = $1
          ) AS "outbox"
      `,
      [rollbackId]
    );
    assert.deepEqual(rolledBack.rows, [{ domain: 0, outbox: 0 }]);

    const committedId = "55555555-5555-4555-8555-555555555555";
    await withDatabaseTransaction(pool, async (transaction) => {
      await transaction.query(
        `
          INSERT INTO "organizations" ("id", "name", "slug")
          VALUES ($1, $2, $3)
        `,
        [committedId, "Committed Test Organization", "committed-test"]
      );
      await enqueueOutboxEvent(transaction, {
        aggregateId: committedId,
        aggregateType: "organization",
        deduplicationKey: `organization.created:${committedId}`,
        payload: { organizationId: committedId },
        topic: "organization.created",
      });
    });

    for (let index = 0; index < 20; index += 1) {
      await outbox.enqueue({
        deduplicationKey: `concurrency:${index}`,
        payload: { index },
        topic: "integration.concurrent",
      });
    }

    const deduplicated = await Promise.all(
      Array.from({ length: 10 }, () =>
        outbox.enqueue({
          deduplicationKey: "integration:deduplicated-concurrently",
          payload: { kind: "deduplicated" },
          topic: "integration.deduplicated",
        })
      )
    );
    assert.equal(new Set(deduplicated.map(({ id }) => id)).size, 1);

    const [workerOne, workerTwo] = await Promise.all([
      outbox.claimBatch({
        batchSize: 100,
        leaseMs: 30_000,
        workerId: "integration-worker-one",
      }),
      outbox.claimBatch({
        batchSize: 100,
        leaseMs: 30_000,
        workerId: "integration-worker-two",
      }),
    ]);
    const claimedIds = [...workerOne, ...workerTwo].map((event) => event.id);

    assert.equal(claimedIds.length, 23);
    assert.equal(new Set(claimedIds).size, 23);

    await Promise.all([
      ...workerOne.map((event) =>
        outbox.completeEvent({
          eventId: event.id,
          handlerName: event.topic,
          workerId: "integration-worker-one",
        })
      ),
      ...workerTwo.map((event) =>
        outbox.completeEvent({
          eventId: event.id,
          handlerName: event.topic,
          workerId: "integration-worker-two",
        })
      ),
    ]);

    const seededEvent = [...workerOne, ...workerTwo].find(
      (event) => event.aggregateId === "22222222-2222-4222-8222-222222222222"
    );
    assert.ok(seededEvent);
    assert.equal(await outbox.hasHandlerReceipt(seededEvent.id), true);

    await pool.query(
      `
        UPDATE "outbox_events"
        SET
          "status" = 'pending',
          "available_at" = clock_timestamp(),
          "completed_at" = NULL,
          "updated_at" = clock_timestamp()
        WHERE "id" = $1
      `,
      [seededEvent.id]
    );
    const [redelivery] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-redelivery",
    });
    assert.equal(redelivery?.id, seededEvent.id);
    assert.equal(await outbox.hasHandlerReceipt(seededEvent.id), true);
    await outbox.completeEvent({
      eventId: seededEvent.id,
      handlerName: seededEvent.topic,
      workerId: "integration-redelivery",
    });

    await outbox.enqueue({
      availableAt: new Date(Date.now() + 600_000),
      deduplicationKey: "integration:delayed",
      payload: { kind: "delayed" },
      topic: "integration.delayed",
    });
    assert.deepEqual(
      await outbox.claimBatch({
        batchSize: 100,
        leaseMs: 30_000,
        workerId: "integration-delay-check",
      }),
      []
    );

    const retryEvent = await outbox.enqueue({
      deduplicationKey: "integration:retry",
      maxAttempts: 2,
      payload: { kind: "retry" },
      topic: "integration.retry",
    });
    const [firstAttempt] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-retry",
    });
    assert.equal(firstAttempt?.id, retryEvent.id);
    const retry = await outbox.failEvent({
      errorCode: "synthetic_failure",
      eventId: retryEvent.id,
      retryDelayMs: 0,
      workerId: "integration-retry",
    });
    assert.equal(retry.attemptCount, 1);
    assert.equal(retry.status, "pending");
    const [secondAttempt] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-retry",
    });
    assert.equal(secondAttempt?.id, retryEvent.id);
    const deadLetter = await outbox.failEvent({
      errorCode: "synthetic_failure",
      eventId: retryEvent.id,
      retryDelayMs: 0,
      workerId: "integration-retry",
    });
    assert.equal(deadLetter.attemptCount, 2);
    assert.equal(deadLetter.status, "dead_letter");

    const leaseEvent = await outbox.enqueue({
      deduplicationKey: "integration:lease",
      payload: { kind: "lease" },
      topic: "integration.lease",
    });
    await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-expired-worker",
    });
    await pool.query(
      `
        UPDATE "outbox_events"
        SET "locked_until" = clock_timestamp() - interval '1 second'
        WHERE "id" = $1
      `,
      [leaseEvent.id]
    );
    const [reclaimed] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-reclaimer",
    });
    assert.equal(reclaimed?.id, leaseEvent.id);
    assert.equal(reclaimed?.attemptCount, 2);
    await outbox.completeEvent({
      eventId: leaseEvent.id,
      handlerName: leaseEvent.topic,
      workerId: "integration-reclaimer",
    });

    const shutdownEvent = await outbox.enqueue({
      deduplicationKey: "integration:shutdown",
      payload: { kind: "shutdown" },
      topic: "integration.shutdown",
    });
    await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-stopping-worker",
    });
    assert.equal(await outbox.releaseClaims("integration-stopping-worker"), 1);
    const [released] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-next-worker",
    });
    assert.equal(released?.id, shutdownEvent.id);
    await outbox.completeEvent({
      eventId: shutdownEvent.id,
      handlerName: shutdownEvent.topic,
      workerId: "integration-next-worker",
    });

    const scheduleId = await outbox.upsertSchedule({
      intervalSeconds: 3_600,
      name: "integration-hourly",
      nextRunAt: new Date(Date.now() - 1_000),
      payload: { kind: "scheduled" },
      topic: "integration.scheduled",
    });
    const materialized = await Promise.all([
      outbox.materializeDueSchedules(10),
      outbox.materializeDueSchedules(10),
    ]);
    assert.equal(
      materialized.reduce((total, count) => total + count, 0),
      1
    );
    const scheduledEvents = await pool.query(
      `
        SELECT count(*)::int AS "count"
        FROM "outbox_events"
        WHERE "schedule_id" = $1
      `,
      [scheduleId]
    );
    assert.deepEqual(scheduledEvents.rows, [{ count: 1 }]);
    const [scheduled] = await outbox.claimBatch({
      batchSize: 1,
      leaseMs: 30_000,
      workerId: "integration-schedule-worker",
    });
    assert.equal(scheduled?.topic, "integration.scheduled");
    await outbox.completeEvent({
      eventId: scheduled!.id,
      handlerName: scheduled!.topic,
      workerId: "integration-schedule-worker",
    });

    const metrics = await outbox.metrics();
    assert.equal(metrics.deadLetter, 1);
    assert.equal(metrics.pendingDelayed, 1);
    assert.equal(metrics.pendingReady, 0);
    assert.equal(metrics.processing, 0);

    const seededUser = await pool.query(
      `SELECT "password_hash" AS "passwordHash" FROM "users" WHERE "id" = $1`,
      ["11111111-1111-4111-8111-111111111111"]
    );
    assert.match(
      String(seededUser.rows[0]?.passwordHash),
      /^\$argon2id\$/,
      "The seeded user must carry an argon2id password hash."
    );

    const authUser = await createUser(pool, {
      email: "auth-probe@example.test",
      passwordHash: "$argon2id$synthetic-integration-hash",
    });
    assert.ok(authUser);
    assert.equal(authUser.status, "pending");
    assert.equal(
      await createUser(pool, {
        email: "auth-probe@example.test",
        passwordHash: "$argon2id$other-hash",
      }),
      null,
      "A duplicate email must not create a second user."
    );

    const verifiedUser = await markUserEmailVerified(pool, authUser.id);
    assert.equal(verifiedUser?.status, "active");
    assert.equal(
      await markUserEmailVerified(pool, authUser.id),
      null,
      "Verification must only transition pending users."
    );

    const singleUseSecret = generateAuthSecret();
    await createAuthToken(pool, {
      expiresAt: new Date(Date.now() + 60_000),
      purpose: "password_reset",
      tokenHash: hashAuthSecret(singleUseSecret),
      userId: authUser.id,
    });
    const concurrentConsumes = await Promise.all(
      Array.from({ length: 5 }, () =>
        consumeAuthToken(pool, {
          purpose: "password_reset",
          tokenHash: hashAuthSecret(singleUseSecret),
        })
      )
    );
    assert.equal(
      concurrentConsumes.filter((token) => token !== null).length,
      1,
      "A token must be consumable exactly once under concurrency."
    );

    const expiredSecret = generateAuthSecret();
    const expiredToken = await createAuthToken(pool, {
      expiresAt: new Date(Date.now() + 60_000),
      purpose: "password_reset",
      tokenHash: hashAuthSecret(expiredSecret),
      userId: authUser.id,
    });
    await pool.query(
      `
        UPDATE "auth_tokens"
        SET
          "created_at" = clock_timestamp() - interval '2 hours',
          "expires_at" = clock_timestamp() - interval '1 hour'
        WHERE "id" = $1
      `,
      [expiredToken.id]
    );
    assert.equal(
      await consumeAuthToken(pool, {
        purpose: "password_reset",
        tokenHash: hashAuthSecret(expiredSecret),
      }),
      null,
      "An expired token must not be consumable."
    );

    await assert.rejects(
      pool.query(
        `
          INSERT INTO "sessions"
            ("user_id", "token_hash", "csrf_token_hash", "absolute_expires_at")
          VALUES ($1, 'not-a-sha256-hash', $2, clock_timestamp() + interval '1 hour')
        `,
        [authUser.id, hashAuthSecret(generateAuthSecret())]
      ),
      /sessions_token_hash_format|value too long/,
      "The database must reject malformed session token hashes."
    );

    const keepSecret = generateAuthSecret();
    const keepSession = await createSession(pool, {
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      csrfTokenHash: hashAuthSecret(generateAuthSecret()),
      deviceSummary: "integration-keep",
      tokenHash: hashAuthSecret(keepSecret),
      userId: authUser.id,
    });
    const dropSession = await createSession(pool, {
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      csrfTokenHash: hashAuthSecret(generateAuthSecret()),
      deviceSummary: "integration-drop",
      tokenHash: hashAuthSecret(generateAuthSecret()),
      userId: authUser.id,
    });
    assert.equal(
      await revokeSessionById(pool, {
        sessionId: dropSession.id,
        userId: authUser.id,
      }),
      true
    );
    assert.equal(
      await revokeSessionById(pool, {
        sessionId: dropSession.id,
        userId: authUser.id,
      }),
      false,
      "Revocation must be idempotent and report no second change."
    );
    const activeSessions = await listActiveSessions(pool, {
      idleCutoff: new Date(Date.now() - 60_000),
      userId: authUser.id,
    });
    assert.deepEqual(
      activeSessions.map((session) => session.id),
      [keepSession.id],
      "Only unrevoked, unexpired sessions may be listed."
    );
    assert.equal(
      await revokeUserSessions(pool, { userId: authUser.id }),
      1,
      "Revoking every session must count the remaining active one."
    );

    const seededOrganizationId = "22222222-2222-4222-8222-222222222222";
    const seededVenueId = "66666666-6666-4666-8666-666666666666";
    const seededLayout = await fetchVenueLayout(pool, seededVenueId);
    assert.equal(seededLayout.length, 2);
    assert.equal(seededLayout[0]?.rows.length, 2);
    assert.equal(seededLayout[1]?.gaCapacity, 250);

    assert.equal(
      await findVenueById(pool, {
        organizationId: "55555555-5555-4555-8555-555555555555",
        venueId: seededVenueId,
      }),
      null,
      "A venue must be invisible outside its owning organization."
    );

    const probeVenue = await insertVenue(pool, {
      description: null,
      name: "Integration Probe Hall",
      organizationId: seededOrganizationId,
    });
    assert.ok(probeVenue);
    assert.equal(
      await insertVenue(pool, {
        description: null,
        name: "Integration Probe Hall",
        organizationId: seededOrganizationId,
      }),
      null,
      "Duplicate venue names within one organization must be rejected."
    );

    const probeLayout = [
      {
        gaCapacity: null,
        kind: "assigned" as const,
        name: "Probe Stalls",
        rows: [
          {
            label: "A",
            seats: [
              { accessible: true, companion: false, label: "1", x: 0, y: 0 },
              { accessible: false, companion: true, label: "2", x: 1, y: 0 },
            ],
          },
        ],
      },
    ];
    const layoutRaces = await Promise.all(
      ["one", "two"].map(() =>
        withDatabaseTransaction(pool, async (transaction) => {
          const claimed = await claimVenueVersion(transaction, {
            expectedVersion: probeVenue.version,
            organizationId: seededOrganizationId,
            venueId: probeVenue.id,
          });
          if (!claimed) {
            return "conflict";
          }
          await replaceVenueLayout(transaction, {
            sections: probeLayout,
            venueId: probeVenue.id,
          });
          return "replaced";
        })
      )
    );
    assert.deepEqual(
      layoutRaces.toSorted(),
      ["conflict", "replaced"],
      "Concurrent layout replacements must have exactly one winner."
    );
    const roundTripped = await fetchVenueLayout(pool, probeVenue.id);
    assert.deepEqual(roundTripped, probeLayout);

    const summaries = await listVenuesForOrganization(
      pool,
      seededOrganizationId
    );
    const probeSummary = summaries.find((row) => row.id === probeVenue.id);
    assert.equal(probeSummary?.seatCount, 2);
    assert.equal(probeSummary?.accessibleSeatCount, 1);
    assert.equal(probeSummary?.generalAdmissionCapacity, 0);

    const probeSection = await pool.query<{ id: string }>(
      `SELECT "id" FROM "venue_sections" WHERE "venue_id" = $1`,
      [probeVenue.id]
    );
    const probeSectionId = probeSection.rows[0]?.id;
    assert.ok(probeSectionId);
    await assert.rejects(
      pool.query(
        `INSERT INTO "venue_rows" ("section_id", "label", "position")
         VALUES ($1, 'A', 9)`,
        [probeSectionId]
      ),
      /venue_rows_section_id_label_key/,
      "Duplicate row labels within a section must be rejected."
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO "venue_sections"
           ("venue_id", "name", "kind", "ga_capacity", "position")
         VALUES ($1, 'Broken GA', 'general_admission', 0, 9)`,
        [probeVenue.id]
      ),
      /venue_sections_kind_capacity/,
      "A general-admission section must carry a positive capacity."
    );
    const probeRow = await pool.query<{ id: string }>(
      `SELECT "id" FROM "venue_rows" WHERE "section_id" = $1 LIMIT 1`,
      [probeSectionId]
    );
    const probeRowId = probeRow.rows[0]?.id;
    assert.ok(probeRowId);
    await assert.rejects(
      pool.query(
        `INSERT INTO "venue_seats" ("row_id", "label", "x", "y")
         VALUES ($1, 'far', 2000, 0)`,
        [probeRowId]
      ),
      /venue_seats_coordinates_bounded/,
      "Out-of-range seat coordinates must be rejected."
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO "venue_seats"
           ("row_id", "label", "x", "y", "accessible", "companion")
         VALUES ($1, 'both', 9, 9, true, true)`,
        [probeRowId]
      ),
      /venue_seats_access_roles_exclusive/,
      "A seat cannot be both accessible and companion."
    );

    assert.equal(
      await deleteVenueById(pool, {
        organizationId: seededOrganizationId,
        venueId: probeVenue.id,
      }),
      true
    );
    const orphans = await pool.query(
      `SELECT count(*)::int AS "count" FROM "venue_sections"
       WHERE "venue_id" = $1`,
      [probeVenue.id]
    );
    assert.deepEqual(
      orphans.rows,
      [{ count: 0 }],
      "Deleting a venue must cascade to its layout."
    );

    const eventSections = await fetchVenueSectionSummaries(pool, seededVenueId);
    assert.equal(eventSections.length, 2);
    const assignedSection = eventSections.find(
      (section) => section.kind === "assigned"
    );
    const gaSection = eventSections.find(
      (section) => section.kind === "general_admission"
    );
    assert.ok(assignedSection);
    assert.ok(gaSection);
    assert.ok(assignedSection.seatCount > 0);

    const draftEvent = await insertEvent(pool, {
      organizationId: seededOrganizationId,
      title: "Integration Concert",
      venueId: seededVenueId,
    });
    assert.equal(draftEvent.status, "draft");
    assert.equal(draftEvent.version, 1);

    const updatedDraft = await updateEventDraft(pool, {
      currency: "USD",
      description: "An integration probe event.",
      endsAt: new Date("2026-09-01T04:00:00.000Z"),
      eventId: draftEvent.id,
      expectedVersion: 1,
      holdDurationSeconds: 600,
      mediaUrl: null,
      organizationId: seededOrganizationId,
      refundPolicy: "Full refund up to 24 hours before.",
      salesEndAt: new Date("2026-08-31T23:00:00.000Z"),
      salesStartAt: new Date("2026-08-01T00:00:00.000Z"),
      startsAt: new Date("2026-09-01T01:00:00.000Z"),
      timezone: "America/Toronto",
      title: "Integration Concert",
    });
    assert.equal(updatedDraft?.version, 2);
    assert.equal(
      await updateEventDraft(pool, {
        currency: "USD",
        description: null,
        endsAt: null,
        eventId: draftEvent.id,
        expectedVersion: 1,
        holdDurationSeconds: 600,
        mediaUrl: null,
        organizationId: seededOrganizationId,
        refundPolicy: null,
        salesEndAt: null,
        salesStartAt: null,
        startsAt: null,
        timezone: "UTC",
        title: "Stale Update",
      }),
      null,
      "A stale draft update must not overwrite a newer version."
    );

    await withDatabaseTransaction(pool, async (transaction) => {
      const claimed = await claimEventVersion(transaction, {
        eventId: draftEvent.id,
        expectedVersion: 2,
        organizationId: seededOrganizationId,
      });
      assert.ok(claimed);
      await replaceTicketTypes(transaction, {
        eventId: draftEvent.id,
        ticketTypes: [
          {
            capacity: null,
            feeMinor: 250,
            kind: "assigned",
            name: "Reserved",
            priceMinor: 5_000,
            sectionName: assignedSection.name,
          },
          {
            capacity: 100,
            feeMinor: 0,
            kind: "general_admission",
            name: "Lawn",
            priceMinor: 3_000,
            sectionName: gaSection.name,
          },
        ],
      });
    });
    const ticketTypes = await fetchTicketTypes(pool, draftEvent.id);
    assert.equal(ticketTypes.length, 2);

    // A publication that fails midway must leave no snapshot and no state change.
    await assert.rejects(
      withDatabaseTransaction(pool, async (transaction) => {
        await claimEventVersion(transaction, {
          eventId: draftEvent.id,
          expectedVersion: 3,
          organizationId: seededOrganizationId,
        });
        await insertEventSeats(transaction, {
          eventId: draftEvent.id,
          priceMinor: 5_000,
          sectionName: assignedSection.name,
          seats: await fetchSectionSeats(transaction, {
            sectionName: assignedSection.name,
            venueId: seededVenueId,
          }),
          ticketTypeId: ticketTypes[0]!.id,
        });
        throw new Error("publish probe rollback");
      }),
      /publish probe rollback/
    );
    const afterRollback = await pool.query<{ seats: number; status: string }>(
      `SELECT
         (SELECT count(*)::int FROM "event_seats" WHERE "event_id" = $1) AS "seats",
         (SELECT "status" FROM "events" WHERE "id" = $1) AS "status"`,
      [draftEvent.id]
    );
    assert.deepEqual(afterRollback.rows, [{ seats: 0, status: "draft" }]);

    // A committed publication snapshots assigned seats and records the effect.
    const assignedTicketType = ticketTypes.find(
      (ticketType) => ticketType.kind === "assigned"
    );
    assert.ok(assignedTicketType);
    const published = await withDatabaseTransaction(
      pool,
      async (transaction) => {
        const claimed = await claimEventVersion(transaction, {
          eventId: draftEvent.id,
          expectedVersion: 3,
          organizationId: seededOrganizationId,
        });
        assert.ok(claimed);
        const seats = await fetchSectionSeats(transaction, {
          sectionName: assignedSection.name,
          venueId: seededVenueId,
        });
        await insertEventSeats(transaction, {
          eventId: draftEvent.id,
          priceMinor: assignedTicketType.priceMinor,
          sectionName: assignedSection.name,
          seats,
          ticketTypeId: assignedTicketType.id,
        });
        await insertAuditLog(transaction, {
          action: "event.published",
          actorUserId: null,
          detail: { seatCount: seats.length },
          organizationId: seededOrganizationId,
          targetId: draftEvent.id,
          targetType: "event",
        });
        await enqueueOutboxEvent(transaction, {
          aggregateId: draftEvent.id,
          aggregateType: "event",
          deduplicationKey: `event.published:${draftEvent.id}`,
          payload: { eventId: draftEvent.id },
          topic: "event.published",
        });
        return markEventPublished(transaction, {
          eventId: draftEvent.id,
          organizationId: seededOrganizationId,
        });
      }
    );
    assert.equal(published?.status, "published");
    assert.ok(published?.publishedAt);

    const snapshot = await pool.query<{ seats: number; sold: number }>(
      `SELECT
         count(*)::int AS "seats",
         count(*) FILTER (WHERE "status" = 'available')::int AS "sold"
       FROM "event_seats" WHERE "event_id" = $1`,
      [draftEvent.id]
    );
    assert.equal(snapshot.rows[0]?.seats, assignedSection.seatCount);
    assert.equal(snapshot.rows[0]?.sold, assignedSection.seatCount);

    const publishEffects = await pool.query<{ audits: number; outbox: number }>(
      `SELECT
         (
           SELECT count(*)::int FROM "audit_logs"
           WHERE "target_id" = $1 AND "action" = 'event.published'
         ) AS "audits",
         (
           SELECT count(*)::int FROM "outbox_events"
           WHERE "aggregate_id" = $1 AND "topic" = 'event.published'
         ) AS "outbox"`,
      [draftEvent.id]
    );
    assert.deepEqual(publishEffects.rows, [{ audits: 1, outbox: 1 }]);

    assert.equal(
      await claimEventVersion(pool, {
        eventId: draftEvent.id,
        expectedVersion: published!.version,
        organizationId: seededOrganizationId,
      }),
      null,
      "A published event must not accept further draft writes."
    );

    // Public discovery reads: published events only, advisory availability,
    // and no blocked seats or internal fields in any response.
    const seededGalaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const draftProbe = await insertEvent(pool, {
      organizationId: seededOrganizationId,
      title: "Discovery Draft Probe",
      venueId: seededVenueId,
    });
    const dayMs = 24 * 60 * 60 * 1000;
    const pastProbe = await insertEvent(pool, {
      organizationId: seededOrganizationId,
      title: "Discovery Past Probe",
      venueId: seededVenueId,
    });
    await updateEventDraft(pool, {
      currency: "USD",
      description: null,
      endsAt: new Date(Date.now() - 7 * dayMs),
      eventId: pastProbe.id,
      expectedVersion: 1,
      holdDurationSeconds: 600,
      mediaUrl: null,
      organizationId: seededOrganizationId,
      refundPolicy: null,
      salesEndAt: new Date(Date.now() - 8 * dayMs),
      salesStartAt: new Date(Date.now() - 30 * dayMs),
      startsAt: new Date(Date.now() - 8 * dayMs),
      timezone: "UTC",
      title: "Discovery Past Probe",
    });
    assert.ok(
      await markEventPublished(pool, {
        eventId: pastProbe.id,
        organizationId: seededOrganizationId,
      })
    );

    const allListing = await listPublishedEvents(pool, {
      limit: 50,
      offset: 0,
      timeframe: "all",
    });
    const listedIds = allListing.events.map((event) => event.id);
    assert.ok(listedIds.includes(seededGalaId));
    assert.ok(listedIds.includes(draftEvent.id));
    assert.ok(listedIds.includes(pastProbe.id));
    assert.ok(
      !listedIds.includes(draftProbe.id),
      "A draft event must never be discoverable."
    );
    assert.equal(allListing.total, listedIds.length);

    const seededGalaSummary = allListing.events.find(
      (event) => event.id === seededGalaId
    );
    assert.ok(seededGalaSummary);
    assert.deepEqual(Object.keys(seededGalaSummary).sort(), [
      "currency",
      "endsAt",
      "id",
      "mediaUrl",
      "minPriceMinor",
      "salesEndAt",
      "salesStartAt",
      "startsAt",
      "timezone",
      "title",
      "venueName",
    ]);
    assert.equal(seededGalaSummary.venueName, "Example Test Hall");
    assert.equal(seededGalaSummary.minPriceMinor, 1800);

    const upcomingListing = await listPublishedEvents(pool, {
      limit: 50,
      offset: 0,
      timeframe: "upcoming",
    });
    const upcomingIds = upcomingListing.events.map((event) => event.id);
    assert.ok(upcomingIds.includes(seededGalaId));
    assert.ok(!upcomingIds.includes(pastProbe.id));

    const pastListing = await listPublishedEvents(pool, {
      limit: 50,
      offset: 0,
      timeframe: "past",
    });
    const pastIds = pastListing.events.map((event) => event.id);
    assert.ok(pastIds.includes(pastProbe.id));
    assert.ok(!pastIds.includes(seededGalaId));

    const searched = await listPublishedEvents(pool, {
      limit: 50,
      offset: 0,
      search: "GALA",
      timeframe: "all",
    });
    assert.deepEqual(
      searched.events.map((event) => event.id),
      [seededGalaId],
      "Search must match titles case-insensitively."
    );
    const wildcardProbe = await listPublishedEvents(pool, {
      limit: 50,
      offset: 0,
      search: "%",
      timeframe: "all",
    });
    assert.equal(
      wildcardProbe.total,
      0,
      "LIKE wildcards in a search term must be treated literally."
    );

    const galaDetail = await findPublishedEventById(pool, seededGalaId);
    assert.ok(galaDetail);
    assert.equal(galaDetail.venueName, "Example Test Hall");
    assert.ok(galaDetail.refundPolicy);
    assert.equal(
      await findPublishedEventById(pool, draftProbe.id),
      null,
      "A draft event must not resolve publicly."
    );

    const galaTicketTypes = await fetchPublicTicketTypes(pool, seededGalaId);
    assert.deepEqual(galaTicketTypes, [
      {
        feeMinor: 250,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        kind: "assigned",
        name: "Stalls Reserved",
        priceMinor: 2500,
        sectionName: "Stalls",
      },
      {
        feeMinor: 150,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        kind: "general_admission",
        name: "Standing Floor",
        priceMinor: 1800,
        sectionName: "Standing Floor",
      },
    ]);

    const galaSeats = await fetchAvailabilitySeats(pool, seededGalaId);
    assert.equal(
      galaSeats.length,
      7,
      "The blocked seat must be excluded from availability."
    );
    assert.ok(
      galaSeats.every(
        (seat) => seat.id !== "cccccccc-cccc-4ccc-8ccc-ccccccccccc8"
      )
    );
    assert.equal(
      galaSeats.filter((seat) => seat.status === "available").length,
      6
    );
    assert.equal(galaSeats.filter((seat) => seat.status === "sold").length, 1);

    const galaGeneralAdmission = await fetchGeneralAdmissionCapacity(
      pool,
      seededGalaId
    );
    assert.deepEqual(galaGeneralAdmission, [
      {
        capacity: 200,
        feeMinor: 150,
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        name: "Standing Floor",
        priceMinor: 1800,
      },
    ]);

    // General-admission holds: locked ticket-type counters that never oversell,
    // reserve once under contention, and move reserved to sold on finalization.
    const seededUserId = "11111111-1111-4111-8111-111111111111";
    const gaSectionName = gaSection.name;

    async function createGaTicketType(
      capacity: number
    ): Promise<{ eventId: string; ticketTypeId: string }> {
      const event = await insertEvent(pool, {
        organizationId: seededOrganizationId,
        title: `GA Holds Probe ${randomUUID()}`,
        venueId: seededVenueId,
      });
      await withDatabaseTransaction(pool, async (transaction) => {
        const claimed = await claimEventVersion(transaction, {
          eventId: event.id,
          expectedVersion: 1,
          organizationId: seededOrganizationId,
        });
        assert.ok(claimed);
        await replaceTicketTypes(transaction, {
          eventId: event.id,
          ticketTypes: [
            {
              capacity,
              feeMinor: 100,
              kind: "general_admission",
              name: "Floor",
              priceMinor: 2_500,
              sectionName: gaSectionName,
            },
          ],
        });
      });
      const [ticketType] = await fetchTicketTypes(pool, event.id);
      assert.ok(ticketType);
      return { eventId: event.id, ticketTypeId: ticketType.id };
    }

    const oversell = await createGaTicketType(5);
    const oversellAttempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_unused, index) =>
        withDatabaseTransaction(pool, (transaction) =>
          createGeneralAdmissionHold(transaction, {
            actor: { guestSessionId: `oversell-guest-${index}` },
            eventId: oversell.eventId,
            idempotencyKey: `oversell-${index}`,
            items: [{ quantity: 2, ticketTypeId: oversell.ticketTypeId }],
          })
        )
      )
    );
    const oversellWon = oversellAttempts.filter(
      (attempt) => attempt.status === "fulfilled"
    );
    const oversellLost = oversellAttempts.filter(
      (attempt) => attempt.status === "rejected"
    );
    assert.equal(
      oversellWon.length,
      2,
      "Only two holds of two units each fit within a capacity of five."
    );
    assert.ok(
      oversellLost.every(
        (attempt) =>
          attempt.reason instanceof Error &&
          attempt.reason.name === "HoldCapacityError"
      ),
      "Every rejected create must fail with a capacity error, never oversell."
    );
    const [oversellState] = await fetchGeneralAdmissionAvailability(
      pool,
      oversell.eventId
    );
    assert.ok(oversellState);
    assert.deepEqual(
      {
        available: oversellState.available,
        reserved: oversellState.reserved,
        sold: oversellState.sold,
      },
      { available: 1, reserved: 4, sold: 0 }
    );
    assert.ok(
      oversellState.reserved >= 0 &&
        oversellState.sold >= 0 &&
        oversellState.reserved + oversellState.sold <= oversellState.capacity,
      "Counters stay nonnegative and within capacity."
    );

    // A repeated idempotency key returns the same hold and reserves only once.
    const firstHold = await withDatabaseTransaction(pool, (transaction) =>
      createGeneralAdmissionHold(transaction, {
        actor: { userId: seededUserId },
        eventId: oversell.eventId,
        idempotencyKey: "oversell-idem",
        items: [{ quantity: 1, ticketTypeId: oversell.ticketTypeId }],
      })
    );
    assert.equal(firstHold.replayed, false);
    const replayedHold = await withDatabaseTransaction(pool, (transaction) =>
      createGeneralAdmissionHold(transaction, {
        actor: { userId: seededUserId },
        eventId: oversell.eventId,
        idempotencyKey: "oversell-idem",
        items: [{ quantity: 1, ticketTypeId: oversell.ticketTypeId }],
      })
    );
    assert.equal(replayedHold.replayed, true);
    assert.equal(replayedHold.id, firstHold.id);
    const [afterReplay] = await fetchGeneralAdmissionAvailability(
      pool,
      oversell.eventId
    );
    assert.ok(afterReplay);
    assert.deepEqual(
      { available: afterReplay.available, reserved: afterReplay.reserved },
      { available: 0, reserved: 5 }
    );

    // A roomy ticket type for the lifecycle transitions below.
    const lifecycle = await createGaTicketType(100);
    const availabilityOf = async (): Promise<{
      reserved: number;
      sold: number;
    }> => {
      const [row] = await fetchGeneralAdmissionAvailability(
        pool,
        lifecycle.eventId
      );
      assert.ok(row);
      return { reserved: row.reserved, sold: row.sold };
    };

    // Concurrent duplicate requests collapse to a single reservation.
    const concurrentActor = { guestSessionId: "concurrent-guest" };
    const concurrentHolds = await Promise.all(
      Array.from({ length: 5 }, () =>
        withDatabaseTransaction(pool, (transaction) =>
          createGeneralAdmissionHold(transaction, {
            actor: concurrentActor,
            eventId: lifecycle.eventId,
            idempotencyKey: "concurrent-key",
            items: [{ quantity: 3, ticketTypeId: lifecycle.ticketTypeId }],
          })
        )
      )
    );
    assert.equal(
      new Set(concurrentHolds.map((hold) => hold.id)).size,
      1,
      "Concurrent duplicate creates must resolve to one hold."
    );
    assert.deepEqual(await availabilityOf(), { reserved: 3, sold: 0 });

    // Expiration returns reserved quantity exactly once.
    const expiringHold = await withDatabaseTransaction(pool, (transaction) =>
      createGeneralAdmissionHold(transaction, {
        actor: { guestSessionId: "expiry-guest" },
        eventId: lifecycle.eventId,
        idempotencyKey: "expiry-1",
        items: [{ quantity: 4, ticketTypeId: lifecycle.ticketTypeId }],
      })
    );
    assert.deepEqual(await availabilityOf(), { reserved: 7, sold: 0 });
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 minute'
       WHERE "id" = $1`,
      [expiringHold.id]
    );
    assert.equal(await expireDueHolds(pool, { limit: 100 }), 1);
    assert.deepEqual(await availabilityOf(), { reserved: 3, sold: 0 });
    // A second sweep and a direct re-expire are no-ops.
    assert.equal(await expireDueHolds(pool, { limit: 100 }), 0);
    const reExpire = await withDatabaseTransaction(pool, (transaction) =>
      expireHold(transaction, expiringHold.id)
    );
    assert.deepEqual(reExpire, { changed: false, status: "expired" });
    assert.deepEqual(await availabilityOf(), { reserved: 3, sold: 0 });

    // Finalization atomically moves reserved quantity to sold, idempotently.
    const purchase = await withDatabaseTransaction(pool, (transaction) =>
      createGeneralAdmissionHold(transaction, {
        actor: { guestSessionId: "buyer" },
        eventId: lifecycle.eventId,
        idempotencyKey: "buy-1",
        items: [{ quantity: 2, ticketTypeId: lifecycle.ticketTypeId }],
      })
    );
    assert.deepEqual(await availabilityOf(), { reserved: 5, sold: 0 });
    const finalized = await withDatabaseTransaction(pool, (transaction) =>
      finalizeGeneralAdmissionHold(transaction, purchase.id)
    );
    assert.deepEqual(finalized, { changed: true, status: "consumed" });
    assert.deepEqual(await availabilityOf(), { reserved: 3, sold: 2 });
    const refinalized = await withDatabaseTransaction(pool, (transaction) =>
      finalizeGeneralAdmissionHold(transaction, purchase.id)
    );
    assert.deepEqual(refinalized, { changed: false, status: "consumed" });
    assert.deepEqual(await availabilityOf(), { reserved: 3, sold: 2 });

    // An expired hold cannot check out.
    const staleHold = await withDatabaseTransaction(pool, (transaction) =>
      createGeneralAdmissionHold(transaction, {
        actor: { guestSessionId: "stale-buyer" },
        eventId: lifecycle.eventId,
        idempotencyKey: "stale-1",
        items: [{ quantity: 1, ticketTypeId: lifecycle.ticketTypeId }],
      })
    );
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 minute'
       WHERE "id" = $1`,
      [staleHold.id]
    );
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        finalizeGeneralAdmissionHold(transaction, staleHold.id)
      ),
      (error: unknown) =>
        error instanceof Error && error.name === "HoldNotFinalizableError"
    );

    // An actor cancels its own hold and returns the reservation; a stranger cannot.
    const cancelActor = { guestSessionId: "canceller" };
    const cancellable = await withDatabaseTransaction(pool, (transaction) =>
      createGeneralAdmissionHold(transaction, {
        actor: cancelActor,
        eventId: lifecycle.eventId,
        idempotencyKey: "cancel-1",
        items: [{ quantity: 2, ticketTypeId: lifecycle.ticketTypeId }],
      })
    );
    const beforeCancel = await availabilityOf();
    const cancelled = await withDatabaseTransaction(pool, (transaction) =>
      cancelHold(transaction, { actor: cancelActor, holdId: cancellable.id })
    );
    assert.deepEqual(cancelled, { changed: true, status: "cancelled" });
    assert.equal((await availabilityOf()).reserved, beforeCancel.reserved - 2);
    // The owner re-cancelling is an idempotent no-op that returns no quantity.
    const reCancelled = await withDatabaseTransaction(pool, (transaction) =>
      cancelHold(transaction, { actor: cancelActor, holdId: cancellable.id })
    );
    assert.deepEqual(reCancelled, { changed: false, status: "cancelled" });
    assert.equal((await availabilityOf()).reserved, beforeCancel.reserved - 2);
    // A stranger cannot see or cancel another actor's hold.
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        cancelHold(transaction, {
          actor: { guestSessionId: "intruder" },
          holdId: cancellable.id,
        })
      ),
      (error: unknown) =>
        error instanceof Error && error.name === "HoldNotFoundError",
      "A stranger's cancel is rejected as if the hold does not exist."
    );

    await redis.connect();
    await redis.set(`${redisPrefix}probe`, "isolated", "EX", 30);
    assert.equal(await redis.get(`${redisPrefix}probe`), "isolated");

    // The Redis mirror advises a hold's expiry as a TTL key; Postgres stays
    // authoritative, so the mirror only ever accelerates client countdowns.
    const holdMirrorClient = {
      del: (key: string): Promise<number> => redis.del(key),
      get: (key: string): Promise<string | null> => redis.get(key),
      set: (
        key: string,
        value: string,
        mode: "PX",
        ttlMs: number
      ): Promise<string | null> => redis.set(key, value, mode, ttlMs),
    };
    const mirrorExpiry = new Date(Date.now() + 60_000);
    assert.equal(
      await mirrorHoldExpiry(holdMirrorClient, {
        expiresAt: mirrorExpiry,
        holdId: purchase.id,
        prefix: redisPrefix,
      }),
      true
    );
    const mirroredExpiry = await readHoldExpiry(holdMirrorClient, {
      holdId: purchase.id,
      prefix: redisPrefix,
    });
    assert.equal(mirroredExpiry?.toISOString(), mirrorExpiry.toISOString());
    const mirroredTtl = await redis.pttl(
      holdExpiryKey(redisPrefix, purchase.id)
    );
    assert.ok(
      mirroredTtl > 0 && mirroredTtl <= 60_000,
      "The mirror TTL tracks the remaining hold lifetime."
    );
    await clearHoldExpiry(holdMirrorClient, {
      holdId: purchase.id,
      prefix: redisPrefix,
    });
    assert.equal(
      await readHoldExpiry(holdMirrorClient, {
        holdId: purchase.id,
        prefix: redisPrefix,
      }),
      null
    );

    process.stdout.write(
      `${JSON.stringify({
        atomicOutbox: "verified",
        authLifecycle: "verified",
        concurrentClaims: claimedIds.length,
        deadLetters: metrics.deadLetter,
        discovery: "verified",
        event: "integration.completed",
        eventPublishing: "verified",
        generalAdmissionHolds: "verified",
        migrations: "applied",
        redis: "isolated",
        schedules: "verified",
        seedDomainRecords: 27,
        seedOutboxEvents: 1,
        venueLayouts: "verified",
      })}\n`
    );
  } finally {
    await pool.end();
  }
} finally {
  if (redis.status !== "end") {
    if (redis.status === "ready") {
      await deleteRedisScope();
    }
    redis.disconnect();
  }

  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
  await admin.end().catch(() => undefined);
}
