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
  CHECKOUT_GRACE_SECONDS,
  createAssignedSeatHold,
  createGeneralAdmissionHold,
  expireDueHolds,
  expireHold,
  fetchGeneralAdmissionAvailability,
  finalizeGeneralAdmissionHold,
  SeatsUnavailableError,
} from "../src/holds.js";
import {
  attachRefundProviderReference,
  createRefund,
  finalizeRefund,
  markRefundProviderFailure,
  queueOrderNotification,
  RefundStateError,
} from "../src/refunds.js";
import {
  applyRefundResult,
  attachPaymentIntent,
  createOrderForHold,
  finalizeOrderPayment,
  HoldNotCheckoutableError,
  loadCompensationTarget,
  OrderStateError,
  PaymentVerificationError,
  recordPaymentFailure,
  recordWebhookEvent,
} from "../src/orders.js";
import { insertAuditLog } from "../src/organizations.js";
import {
  createDatabasePool,
  createOutboxRepository,
  enqueueOutboxEvent,
  withDatabaseTransaction,
} from "../src/outbox.js";
import {
  checkInTicket,
  listRecentScans,
  reverseCheckIn,
  type ScanCredential,
} from "../src/scans.js";
import {
  hashQrToken,
  listTicketsForActor,
  loadTicketForActor,
  rotateTicketQrToken,
  TicketNotFoundError,
} from "../src/tickets.js";
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
      customerRefundCutoffMinutes: 1440,
      customerRefundsEnabled: true,
      description: "An integration probe event.",
      endsAt: new Date("2026-09-01T04:00:00.000Z"),
      eventId: draftEvent.id,
      expectedVersion: 1,
      holdDurationSeconds: 600,
      inventoryReturnCutoffMinutes: 1440,
      mediaUrl: null,
      organizationId: seededOrganizationId,
      refundPolicy: "Full refund up to 24 hours before.",
      salesEndAt: new Date("2026-08-31T23:00:00.000Z"),
      salesStartAt: new Date("2026-08-01T00:00:00.000Z"),
      startsAt: new Date("2026-09-01T01:00:00.000Z"),
      timezone: "America/Toronto",
      title: "Integration Concert",
      waitingRoomEnabled: false,
    });
    assert.equal(updatedDraft?.version, 2);
    assert.equal(
      await updateEventDraft(pool, {
        currency: "USD",
        customerRefundCutoffMinutes: 1440,
        customerRefundsEnabled: false,
        description: null,
        endsAt: null,
        eventId: draftEvent.id,
        expectedVersion: 1,
        holdDurationSeconds: 600,
        inventoryReturnCutoffMinutes: 1440,
        mediaUrl: null,
        organizationId: seededOrganizationId,
        refundPolicy: null,
        salesEndAt: null,
        salesStartAt: null,
        startsAt: null,
        timezone: "UTC",
        title: "Stale Update",
        waitingRoomEnabled: false,
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
      customerRefundCutoffMinutes: 1440,
      customerRefundsEnabled: false,
      description: null,
      endsAt: new Date(Date.now() - 7 * dayMs),
      eventId: pastProbe.id,
      expectedVersion: 1,
      holdDurationSeconds: 600,
      inventoryReturnCutoffMinutes: 1440,
      mediaUrl: null,
      organizationId: seededOrganizationId,
      refundPolicy: null,
      salesEndAt: new Date(Date.now() - 8 * dayMs),
      salesStartAt: new Date(Date.now() - 30 * dayMs),
      startsAt: new Date(Date.now() - 8 * dayMs),
      timezone: "UTC",
      title: "Discovery Past Probe",
      waitingRoomEnabled: false,
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

    // Assigned-seat holds: per-seat row locks that elect exactly one winner,
    // never return a partial multi-seat hold, keep PostgreSQL authoritative over
    // Redis, honour database-time expiry, and replay idempotently.
    async function createAssignedSeats(seatCount: number): Promise<{
      eventId: string;
      seatIds: string[];
      ticketTypeId: string;
    }> {
      const eventId = randomUUID();
      const ticketTypeId = randomUUID();
      const seatIds = Array.from({ length: seatCount }, () => randomUUID());
      await withDatabaseTransaction(pool, async (transaction) => {
        await transaction.query(
          `INSERT INTO "events"
             ("id", "organization_id", "venue_id", "title")
           VALUES ($1, $2, $3, $4)`,
          [eventId, seededOrganizationId, seededVenueId, `Assigned ${eventId}`]
        );
        await transaction.query(
          `INSERT INTO "ticket_types"
             ("id", "event_id", "name", "kind", "section_name",
              "price_minor", "fee_minor", "position")
           VALUES ($1, $2, 'Reserved', 'assigned', 'Reserved', $3, $4, 0)`,
          [ticketTypeId, eventId, 4_000, 200]
        );
        await transaction.query(
          `INSERT INTO "event_seats"
             ("id", "event_id", "ticket_type_id", "section_name", "row_label",
              "seat_label", "x", "y", "price_minor", "status")
           SELECT d."id", $2, $3, 'Reserved', 'A', d."seat_label", d."x", 0,
                  $4, 'available'
           FROM unnest($1::uuid[], $5::text[], $6::int[])
             AS d("id", "seat_label", "x")`,
          [
            seatIds,
            eventId,
            ticketTypeId,
            4_000,
            seatIds.map((_seat, index) => String(index + 1)),
            seatIds.map((_seat, index) => index),
          ]
        );
      });
      return { eventId, seatIds, ticketTypeId };
    }

    // At least 100 concurrent attempts for one seat elect exactly one winner.
    const rushFixture = await createAssignedSeats(1);
    const rushSeatId = rushFixture.seatIds[0]!;
    const rushAttempts = await Promise.allSettled(
      Array.from({ length: 100 }, (_unused, index) =>
        withDatabaseTransaction(pool, (transaction) =>
          createAssignedSeatHold(transaction, {
            actor: { guestSessionId: `rush-${index}` },
            eventId: rushFixture.eventId,
            idempotencyKey: `rush-${index}`,
            seatIds: [rushSeatId],
          })
        )
      )
    );
    const rushWon = rushAttempts.filter(
      (attempt) => attempt.status === "fulfilled"
    );
    const rushLost = rushAttempts.filter(
      (attempt) => attempt.status === "rejected"
    );
    assert.equal(
      rushWon.length,
      1,
      "Exactly one of a hundred concurrent attempts wins the seat."
    );
    assert.ok(
      rushLost.every(
        (attempt) =>
          attempt.status === "rejected" &&
          attempt.reason instanceof Error &&
          attempt.reason.name === "SeatsUnavailableError"
      ),
      "Every losing attempt fails with a seats-unavailable conflict."
    );
    const rushWinner = rushWon[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createAssignedSeatHold>>
    >;
    const rushState = await pool.query<{ hold_id: string; status: string }>(
      `SELECT "status", "hold_id" FROM "event_seats" WHERE "id" = $1`,
      [rushSeatId]
    );
    assert.equal(rushState.rows[0]?.status, "held");
    assert.equal(rushState.rows[0]?.hold_id, rushWinner.value.id);

    // Overlapping multi-seat requests never leave a partial hold, and only the
    // unavailable seat id is disclosed.
    const partialFixture = await createAssignedSeats(2);
    const [freeSeatId, takenSeatId] = partialFixture.seatIds as [
      string,
      string,
    ];
    await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { guestSessionId: "seat-owner" },
        eventId: partialFixture.eventId,
        idempotencyKey: "partial-owner",
        seatIds: [takenSeatId],
      })
    );
    let partialError: unknown;
    try {
      await withDatabaseTransaction(pool, (transaction) =>
        createAssignedSeatHold(transaction, {
          actor: { guestSessionId: "seat-rival" },
          eventId: partialFixture.eventId,
          idempotencyKey: "partial-rival",
          seatIds: [freeSeatId, takenSeatId],
        })
      );
    } catch (error) {
      partialError = error;
    }
    assert.ok(
      partialError instanceof SeatsUnavailableError,
      "A conflicting multi-seat request fails as a whole."
    );
    assert.deepEqual(
      (partialError as SeatsUnavailableError).seatIds,
      [takenSeatId],
      "Only the unavailable seat is disclosed, never another customer's hold."
    );
    const partialFreeState = await pool.query<{ status: string }>(
      `SELECT "status" FROM "event_seats" WHERE "id" = $1`,
      [freeSeatId]
    );
    assert.equal(
      partialFreeState.rows[0]?.status,
      "available",
      "A rejected multi-seat request reserves none of its seats."
    );

    // Two concurrent full-set requests for the same seats resolve to one hold
    // that owns every seat; there is never a split.
    const contendFixture = await createAssignedSeats(2);
    const contendAttempts = await Promise.allSettled([
      withDatabaseTransaction(pool, (transaction) =>
        createAssignedSeatHold(transaction, {
          actor: { guestSessionId: "contend-one" },
          eventId: contendFixture.eventId,
          idempotencyKey: "contend-one",
          seatIds: contendFixture.seatIds,
        })
      ),
      withDatabaseTransaction(pool, (transaction) =>
        createAssignedSeatHold(transaction, {
          actor: { guestSessionId: "contend-two" },
          eventId: contendFixture.eventId,
          idempotencyKey: "contend-two",
          seatIds: [...contendFixture.seatIds].reverse(),
        })
      ),
    ]);
    assert.equal(
      contendAttempts.filter((attempt) => attempt.status === "fulfilled")
        .length,
      1,
      "Overlapping full-set requests elect exactly one winner."
    );
    const contendHeld = await pool.query<{ holds: number; seats: number }>(
      `SELECT count(*)::int AS "seats", count(DISTINCT "hold_id")::int AS "holds"
       FROM "event_seats"
       WHERE "event_id" = $1 AND "status" = 'held'`,
      [contendFixture.eventId]
    );
    assert.deepEqual(
      { holds: contendHeld.rows[0]?.holds, seats: contendHeld.rows[0]?.seats },
      { holds: 1, seats: 2 },
      "Both seats belong to a single hold; a partial split never occurs."
    );

    // Database time is authority: a held-but-expired seat is reclaimable before
    // any sweep, and a late sweep never steals the seat from its new owner.
    const reclaimFixture = await createAssignedSeats(1);
    const reclaimSeatId = reclaimFixture.seatIds[0]!;
    const staleAssignedHold = await withDatabaseTransaction(
      pool,
      (transaction) =>
        createAssignedSeatHold(transaction, {
          actor: { guestSessionId: "reclaim-first" },
          eventId: reclaimFixture.eventId,
          idempotencyKey: "reclaim-first",
          seatIds: [reclaimSeatId],
        })
    );
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 minute'
       WHERE "id" = $1`,
      [staleAssignedHold.id]
    );
    const reclaimingHold = await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { guestSessionId: "reclaim-second" },
        eventId: reclaimFixture.eventId,
        idempotencyKey: "reclaim-second",
        seatIds: [reclaimSeatId],
      })
    );
    assert.notEqual(reclaimingHold.id, staleAssignedHold.id);
    const reclaimedState = await pool.query<{
      hold_id: string;
      status: string;
    }>(`SELECT "status", "hold_id" FROM "event_seats" WHERE "id" = $1`, [
      reclaimSeatId,
    ]);
    assert.equal(reclaimedState.rows[0]?.status, "held");
    assert.equal(reclaimedState.rows[0]?.hold_id, reclaimingHold.id);
    // Expiring the original hold now must not free the reclaimed seat.
    const lateExpire = await withDatabaseTransaction(pool, (transaction) =>
      expireHold(transaction, staleAssignedHold.id)
    );
    assert.deepEqual(lateExpire, { changed: true, status: "expired" });
    const afterLateExpire = await pool.query<{
      hold_id: string;
      status: string;
    }>(`SELECT "status", "hold_id" FROM "event_seats" WHERE "id" = $1`, [
      reclaimSeatId,
    ]);
    assert.equal(
      afterLateExpire.rows[0]?.hold_id,
      reclaimingHold.id,
      "A late sweep of an expired hold never reclaims a seat held by another."
    );

    // The reconciliation sweep frees an expired assigned seat.
    const sweepFixture = await createAssignedSeats(1);
    const sweepSeatId = sweepFixture.seatIds[0]!;
    const sweepHold = await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { guestSessionId: "sweep-owner" },
        eventId: sweepFixture.eventId,
        idempotencyKey: "sweep-owner",
        seatIds: [sweepSeatId],
      })
    );
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 minute'
       WHERE "id" = $1`,
      [sweepHold.id]
    );
    assert.ok(
      (await expireDueHolds(pool, { limit: 100 })) >= 1,
      "The sweep expires at least the due assigned hold."
    );
    const sweptState = await pool.query<{ hold_id: string; status: string }>(
      `SELECT "status", "hold_id" FROM "event_seats" WHERE "id" = $1`,
      [sweepSeatId]
    );
    assert.equal(sweptState.rows[0]?.status, "available");
    assert.equal(sweptState.rows[0]?.hold_id, null);

    // Redis loss cannot make held or sold inventory available: PostgreSQL alone
    // decides, so a total mirror flush changes nothing.
    const authorityFixture = await createAssignedSeats(2);
    const [authHeldSeatId, authSoldSeatId] = authorityFixture.seatIds as [
      string,
      string,
    ];
    await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { guestSessionId: "authority-holder" },
        eventId: authorityFixture.eventId,
        idempotencyKey: "authority-hold",
        seatIds: [authHeldSeatId],
      })
    );
    await pool.query(
      `UPDATE "event_seats" SET "status" = 'sold', "hold_id" = NULL
       WHERE "id" = $1`,
      [authSoldSeatId]
    );
    await deleteRedisScope();
    for (const unavailableSeatId of [authHeldSeatId, authSoldSeatId]) {
      await assert.rejects(
        withDatabaseTransaction(pool, (transaction) =>
          createAssignedSeatHold(transaction, {
            actor: { guestSessionId: "authority-raider" },
            eventId: authorityFixture.eventId,
            idempotencyKey: `authority-raid-${unavailableSeatId}`,
            seatIds: [unavailableSeatId],
          })
        ),
        (error: unknown) =>
          error instanceof Error && error.name === "SeatsUnavailableError",
        "PostgreSQL keeps sold and held seats unavailable after a Redis flush."
      );
    }

    // Retrying one logical request returns one hold; concurrent duplicates
    // collapse to a single reservation.
    const idempotencyFixture = await createAssignedSeats(2);
    const [replaySeatId, duplicateSeatId] = idempotencyFixture.seatIds as [
      string,
      string,
    ];
    const replayActor = { userId: seededUserId };
    const firstSeatHold = await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: replayActor,
        eventId: idempotencyFixture.eventId,
        idempotencyKey: "assigned-idem",
        seatIds: [replaySeatId],
      })
    );
    assert.equal(firstSeatHold.replayed, false);
    const replayedSeatHold = await withDatabaseTransaction(
      pool,
      (transaction) =>
        createAssignedSeatHold(transaction, {
          actor: replayActor,
          eventId: idempotencyFixture.eventId,
          idempotencyKey: "assigned-idem",
          seatIds: [replaySeatId],
        })
    );
    assert.equal(replayedSeatHold.replayed, true);
    assert.equal(replayedSeatHold.id, firstSeatHold.id);
    assert.deepEqual(
      replayedSeatHold.seats.map((seat) => seat.eventSeatId),
      [replaySeatId]
    );
    const duplicateSeatHolds = await Promise.all(
      Array.from({ length: 5 }, () =>
        withDatabaseTransaction(pool, (transaction) =>
          createAssignedSeatHold(transaction, {
            actor: { userId: seededUserId },
            eventId: idempotencyFixture.eventId,
            idempotencyKey: "assigned-idem-duplicate",
            seatIds: [duplicateSeatId],
          })
        )
      )
    );
    assert.equal(
      new Set(duplicateSeatHolds.map((hold) => hold.id)).size,
      1,
      "Concurrent identical seat creates resolve to one hold."
    );
    const duplicateHeld = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "event_seats"
       WHERE "id" = $1 AND "status" = 'held'`,
      [duplicateSeatId]
    );
    assert.equal(duplicateHeld.rows[0]?.count, 1);

    // Checkout and payment finalization: one order per hold, provider intents
    // attach idempotently, verified success secures inventory and issues one
    // ticket set exactly once, a lost race compensates instead of substituting,
    // and webhook receipts deduplicate under concurrency.
    async function createCheckoutOrder(input: {
      actorKey: string;
      seatCount: number;
    }): Promise<{
      eventId: string;
      holdId: string;
      orderId: string;
      seatIds: string[];
      totalMinor: number;
    }> {
      const fixture = await createAssignedSeats(input.seatCount);
      const hold = await withDatabaseTransaction(pool, (transaction) =>
        createAssignedSeatHold(transaction, {
          actor: { guestSessionId: input.actorKey },
          eventId: fixture.eventId,
          idempotencyKey: input.actorKey,
          seatIds: fixture.seatIds,
        })
      );
      const order = await withDatabaseTransaction(pool, (transaction) =>
        createOrderForHold(transaction, {
          actor: { guestSessionId: input.actorKey },
          holdId: hold.id,
          provider: "fake",
        })
      );
      return {
        eventId: fixture.eventId,
        holdId: hold.id,
        orderId: order.id,
        seatIds: fixture.seatIds,
        totalMinor: order.totalMinor,
      };
    }

    // Duplicate checkout, raced five ways, returns the one order for the hold.
    const raceFixture = await createAssignedSeats(1);
    const raceHold = await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { userId: seededUserId },
        eventId: raceFixture.eventId,
        idempotencyKey: "checkout-race",
        seatIds: raceFixture.seatIds,
      })
    );
    const racedOrders = await Promise.all(
      Array.from({ length: 5 }, () =>
        withDatabaseTransaction(pool, (transaction) =>
          createOrderForHold(transaction, {
            actor: { userId: seededUserId },
            holdId: raceHold.id,
            provider: "fake",
          })
        )
      )
    );
    assert.equal(
      new Set(racedOrders.map((order) => order.id)).size,
      1,
      "Concurrent duplicate checkouts converge on one order."
    );
    assert.equal(
      racedOrders.filter((order) => !order.replayed).length,
      1,
      "Exactly one duplicate checkout created the order; the rest replayed."
    );
    const racedOrderId = racedOrders[0]!.id;
    assert.equal(racedOrders[0]!.totalMinor, 4_200);
    const racedHoldState = await pool.query<{ status: string }>(
      `SELECT "status" FROM "holds" WHERE "id" = $1`,
      [raceHold.id]
    );
    assert.equal(racedHoldState.rows[0]?.status, "checkout_started");

    // One logical intent: repeat attachment is a no-op, replacement rejected.
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_int_1_secret",
        orderId: racedOrderId,
        providerPaymentIntentId: "pi_int_1",
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_int_1_secret",
        orderId: racedOrderId,
        providerPaymentIntentId: "pi_int_1",
      })
    );
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        attachPaymentIntent(transaction, {
          clientSecret: "pi_int_2_secret",
          orderId: racedOrderId,
          providerPaymentIntentId: "pi_int_2",
        })
      ),
      (error: unknown) => error instanceof OrderStateError,
      "An order never silently swaps to a different payment intent."
    );

    // An expired hold cannot check out (invariant #3).
    const expiredCheckout = await createAssignedSeats(1);
    const expiredCheckoutHold = await withDatabaseTransaction(
      pool,
      (transaction) =>
        createAssignedSeatHold(transaction, {
          actor: { guestSessionId: "expired-checkout" },
          eventId: expiredCheckout.eventId,
          idempotencyKey: "expired-checkout",
          seatIds: expiredCheckout.seatIds,
        })
    );
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 second'
       WHERE "id" = $1`,
      [expiredCheckoutHold.id]
    );
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        createOrderForHold(transaction, {
          actor: { guestSessionId: "expired-checkout" },
          holdId: expiredCheckoutHold.id,
          provider: "fake",
        })
      ),
      (error: unknown) =>
        error instanceof HoldNotCheckoutableError && error.status === "expired",
      "An expired hold cannot start checkout."
    );

    // Verified success finalizes exactly once: seats sell, the hold consumes,
    // one ticket per unit appears, and a concurrent duplicate applies nothing.
    const paidFixture = await createCheckoutOrder({
      actorKey: "finalize-paid",
      seatCount: 2,
    });
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_paid_secret",
        orderId: paidFixture.orderId,
        providerPaymentIntentId: "pi_paid",
      })
    );
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        finalizeOrderPayment(transaction, {
          amountMinor: paidFixture.totalMinor + 1,
          currency: "USD",
          providerPaymentIntentId: "pi_paid",
        })
      ),
      (error: unknown) => error instanceof PaymentVerificationError,
      "A provider amount mismatch never finalizes an order."
    );
    const finalizeRace = await Promise.all([
      withDatabaseTransaction(pool, (transaction) =>
        finalizeOrderPayment(transaction, {
          amountMinor: paidFixture.totalMinor,
          currency: "USD",
          providerPaymentIntentId: "pi_paid",
        })
      ),
      withDatabaseTransaction(pool, (transaction) =>
        finalizeOrderPayment(transaction, {
          amountMinor: paidFixture.totalMinor,
          currency: "USD",
          providerPaymentIntentId: "pi_paid",
        })
      ),
    ]);
    assert.deepEqual(
      finalizeRace.map((result) => result.outcome).sort(),
      ["already_final", "paid"],
      "Concurrent duplicate finalizations apply the transition exactly once."
    );
    const paidState = await pool.query<{
      hold_status: string;
      order_status: string;
      payment_status: string;
      sold_seats: number;
      tickets: number;
    }>(
      `SELECT
         (SELECT o."status"::text FROM "orders" o WHERE o."id" = $1)
           AS "order_status",
         (SELECT p."status"::text FROM "payments" p WHERE p."order_id" = $1)
           AS "payment_status",
         (SELECT h."status"::text FROM "holds" h WHERE h."id" = $2)
           AS "hold_status",
         (SELECT count(*)::int FROM "tickets" t
          WHERE t."order_id" = $1 AND t."status" = 'active') AS "tickets",
         (SELECT count(*)::int FROM "event_seats" s
          WHERE s."event_id" = $3 AND s."status" = 'sold') AS "sold_seats"`,
      [paidFixture.orderId, paidFixture.holdId, paidFixture.eventId]
    );
    assert.deepEqual(paidState.rows[0], {
      hold_status: "consumed",
      order_status: "paid",
      payment_status: "succeeded",
      sold_seats: 2,
      tickets: 2,
    });

    // Refunds serialize on the order, price item quantities on the server,
    // deduplicate requests and provider results, void tickets, and return
    // inventory only before the configured cutoff.
    const refundFixture = await createAssignedSeats(1);
    const refundHold = await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { userId: seededUserId },
        eventId: refundFixture.eventId,
        idempotencyKey: "customer-refund-hold",
        seatIds: refundFixture.seatIds,
      })
    );
    const refundOrder = await withDatabaseTransaction(pool, (transaction) =>
      createOrderForHold(transaction, {
        actor: { userId: seededUserId },
        holdId: refundHold.id,
        provider: "fake",
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_refundable_secret",
        orderId: refundOrder.id,
        providerPaymentIntentId: "pi_refundable",
      })
    );
    await pool.query(
      `UPDATE "events"
       SET "starts_at" = CURRENT_TIMESTAMP + interval '10 days',
           "customer_refunds_enabled" = true,
           "customer_refund_cutoff_minutes" = 60,
           "inventory_return_cutoff_minutes" = 30
       WHERE "id" = $1`,
      [refundFixture.eventId]
    );
    const refundablePaid = await withDatabaseTransaction(pool, (transaction) =>
      finalizeOrderPayment(transaction, {
        amountMinor: refundOrder.totalMinor,
        currency: "USD",
        providerPaymentIntentId: "pi_refundable",
      })
    );
    assert.equal(refundablePaid.outcome, "paid");
    const refundableLine = await pool.query<{ id: string }>(
      `SELECT "id" FROM "order_items" WHERE "order_id" = $1`,
      [refundOrder.id]
    );
    const refundRequests = await Promise.all(
      Array.from({ length: 5 }, () =>
        withDatabaseTransaction(pool, (transaction) =>
          createRefund(transaction, {
            actorUserId: seededUserId,
            idempotencyKey: "customer-refund-race",
            initiator: "customer",
            items: [
              {
                orderItemId: refundableLine.rows[0]!.id,
                quantity: 1,
              },
            ],
            orderId: refundOrder.id,
          })
        )
      )
    );
    assert.equal(
      new Set(refundRequests.map((refund) => refund.id)).size,
      1,
      "Duplicate refund requests converge on one logical refund."
    );
    assert.equal(refundRequests[0]?.amountMinor, refundOrder.totalMinor);
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        createRefund(transaction, {
          actorUserId: seededUserId,
          idempotencyKey: "customer-refund-overage",
          initiator: "customer",
          items: [
            {
              orderItemId: refundableLine.rows[0]!.id,
              quantity: 1,
            },
          ],
          orderId: refundOrder.id,
        })
      ),
      (error: unknown) =>
        error instanceof RefundStateError &&
        error.code === "refund_quantity_exceeded",
      "Pending refunds reserve quantity against later requests."
    );
    const refundId = refundRequests[0]!.id;
    await withDatabaseTransaction(pool, (transaction) =>
      queueOrderNotification(transaction, {
        deduplicationKey: `event.reminder:${refundOrder.id}:24h`,
        kind: "event_reminder",
        orderId: refundOrder.id,
        subject: "Reminder",
        text: "Starts soon",
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      attachRefundProviderReference(transaction, {
        providerRefundId: "re_integration_refund",
        refundId,
      })
    );
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        finalizeRefund(transaction, {
          amountMinor: refundRequests[0]!.amountMinor + 1,
          currency: "USD",
          providerPaymentIntentId: "pi_refundable",
          providerRefundId: "re_integration_refund",
          refundId,
        })
      ),
      (error: unknown) =>
        error instanceof RefundStateError &&
        error.code === "refund_verification_failed",
      "A provider amount mismatch never finalizes a refund."
    );
    const finalizedRefunds = await Promise.all([
      withDatabaseTransaction(pool, (transaction) =>
        finalizeRefund(transaction, {
          amountMinor: refundRequests[0]!.amountMinor,
          currency: "USD",
          providerPaymentIntentId: "pi_refundable",
          providerRefundId: "re_integration_refund",
          refundId,
        })
      ),
      withDatabaseTransaction(pool, (transaction) =>
        finalizeRefund(transaction, {
          amountMinor: refundRequests[0]!.amountMinor,
          currency: "USD",
          providerPaymentIntentId: "pi_refundable",
          providerRefundId: "re_integration_refund",
          refundId,
        })
      ),
    ]);
    assert.deepEqual(
      finalizedRefunds.map((refund) => refund.replayed).sort(),
      [false, true],
      "Duplicate refund finalization applies one ticket and inventory transition."
    );
    const customerRefundedState = await pool.query(
      `SELECT
         (SELECT "status"::text FROM "orders" WHERE "id" = $1)
           AS "order_status",
         (SELECT "status"::text FROM "payments" WHERE "order_id" = $1)
           AS "payment_status",
         (SELECT "status"::text FROM "tickets" WHERE "order_id" = $1)
           AS "ticket_status",
         (SELECT "status"::text FROM "event_seats" WHERE "id" = $2)
           AS "seat_status",
         (SELECT count(*)::int FROM "refunds" WHERE "order_id" = $1)
           AS "refund_count",
         (SELECT count(*)::int FROM "outbox_events"
          WHERE "deduplication_key" = 'refund.requested:' || $3)
           AS "refund_jobs",
         (SELECT "status"::text FROM "notifications"
          WHERE "deduplication_key" = 'event.reminder:' || $1 || ':24h')
           AS "reminder_status"`,
      [refundOrder.id, refundFixture.seatIds[0], refundId]
    );
    assert.deepEqual(customerRefundedState.rows[0], {
      order_status: "refunded",
      payment_status: "refunded",
      refund_count: 1,
      refund_jobs: 1,
      reminder_status: "suppressed",
      seat_status: "available",
      ticket_status: "refunded",
    });

    const lateRefundFixture = await createAssignedSeats(1);
    const lateRefundHold = await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { userId: seededUserId },
        eventId: lateRefundFixture.eventId,
        idempotencyKey: "late-organizer-refund-hold",
        seatIds: lateRefundFixture.seatIds,
      })
    );
    const lateRefundOrder = await withDatabaseTransaction(pool, (transaction) =>
      createOrderForHold(transaction, {
        actor: { userId: seededUserId },
        holdId: lateRefundHold.id,
        provider: "fake",
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_late_refund_secret",
        orderId: lateRefundOrder.id,
        providerPaymentIntentId: "pi_late_refund",
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      finalizeOrderPayment(transaction, {
        amountMinor: lateRefundOrder.totalMinor,
        currency: "USD",
        providerPaymentIntentId: "pi_late_refund",
      })
    );
    await pool.query(
      `UPDATE "events"
       SET "starts_at" = CURRENT_TIMESTAMP - interval '1 minute'
       WHERE "id" = $1`,
      [lateRefundFixture.eventId]
    );
    const lateRefundLine = await pool.query<{ id: string }>(
      `SELECT "id" FROM "order_items" WHERE "order_id" = $1`,
      [lateRefundOrder.id]
    );
    const lateRefund = await withDatabaseTransaction(pool, (transaction) =>
      createRefund(transaction, {
        actorUserId: seededUserId,
        idempotencyKey: "late-organizer-refund",
        initiator: "organizer",
        items: [
          {
            orderItemId: lateRefundLine.rows[0]!.id,
            quantity: 1,
          },
        ],
        orderId: lateRefundOrder.id,
        organizationId: seededOrganizationId,
        reason: "Post-event customer service adjustment",
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      attachRefundProviderReference(transaction, {
        providerRefundId: "re_late_failed",
        refundId: lateRefund.id,
      })
    );
    const failedLateRefund = await withDatabaseTransaction(
      pool,
      (transaction) =>
        markRefundProviderFailure(transaction, {
          amountMinor: lateRefund.amountMinor,
          code: "provider_declined",
          currency: lateRefund.currency,
          providerPaymentIntentId: "pi_late_refund",
          providerRefundId: "re_late_failed",
          refundId: lateRefund.id,
        })
    );
    assert.equal(failedLateRefund.replayed, false);
    const retriedLateRefund = await withDatabaseTransaction(
      pool,
      (transaction) =>
        createRefund(transaction, {
          actorUserId: seededUserId,
          idempotencyKey: "late-organizer-refund-retry",
          initiator: "organizer",
          items: [
            {
              orderItemId: lateRefundLine.rows[0]!.id,
              quantity: 1,
            },
          ],
          orderId: lateRefundOrder.id,
          organizationId: seededOrganizationId,
          reason: "Retry after provider rejection",
        })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      attachRefundProviderReference(transaction, {
        providerRefundId: "re_late_integration_refund",
        refundId: retriedLateRefund.id,
      })
    );
    const lateFinalized = await withDatabaseTransaction(pool, (transaction) =>
      finalizeRefund(transaction, {
        amountMinor: retriedLateRefund.amountMinor,
        currency: retriedLateRefund.currency,
        providerPaymentIntentId: "pi_late_refund",
        providerRefundId: "re_late_integration_refund",
        refundId: retriedLateRefund.id,
      })
    );
    assert.equal(
      lateFinalized.inventoryReturned,
      false,
      "A refund after event start never returns inventory."
    );
    const lateInventory = await pool.query<{
      seatStatus: string;
      ticketStatus: string;
    }>(
      `SELECT
         (SELECT "status"::text FROM "event_seats" WHERE "id" = $1)
           AS "seatStatus",
         (SELECT "status"::text FROM "tickets" WHERE "order_id" = $2)
           AS "ticketStatus"`,
      [lateRefundFixture.seatIds[0], lateRefundOrder.id]
    );
    assert.deepEqual(lateInventory.rows[0], {
      seatStatus: "sold",
      ticketStatus: "void",
    });

    // QR credentials: issuance mints one nonsecret public number per ticket plus
    // an unmatchable placeholder hash (no raw bearer escapes issuance), and the
    // owner materializes and rotates a usable bearer through actor-scoped reads.
    const paidTickets = await withDatabaseTransaction(pool, (transaction) =>
      listTicketsForActor(transaction, {
        actor: { guestSessionId: "finalize-paid" },
      })
    );
    assert.equal(paidTickets.length, 2, "Each paid unit yields one ticket.");
    for (const ticket of paidTickets) {
      assert.match(
        ticket.publicNumber,
        /^TK-[0-9A-F]{12}$/,
        "A ticket public number is a nonsecret TK- code."
      );
      assert.equal(
        ticket.qrRotatedAt,
        null,
        "A freshly issued ticket has not rotated a bearer yet."
      );
      assert.equal(ticket.status, "active");
      assert.ok(
        ticket.eventTimezone.length > 0,
        "A ticket surfaces its event timezone."
      );
      assert.ok(ticket.venueName.length > 0, "A ticket surfaces its venue.");
    }
    const issuedHashes = await pool.query<{ hash: string }>(
      `SELECT "qr_token_hash" AS "hash" FROM "tickets" WHERE "order_id" = $1`,
      [paidFixture.orderId]
    );
    assert.equal(
      new Set(issuedHashes.rows.map((row) => row.hash)).size,
      2,
      "Every issued QR hash is unique."
    );
    for (const row of issuedHashes.rows) {
      assert.match(row.hash, /^[0-9a-f]{64}$/, "A QR hash is 64 hex chars.");
    }
    assert.equal(
      new Set(paidTickets.map((ticket) => ticket.publicNumber)).size,
      2,
      "Every ticket public number is unique."
    );

    // Actor scoping: another actor lists none of these tickets and cannot load one.
    const strangerTickets = await withDatabaseTransaction(pool, (transaction) =>
      listTicketsForActor(transaction, {
        actor: { guestSessionId: "ticket-stranger" },
      })
    );
    assert.equal(
      strangerTickets.filter((ticket) =>
        paidTickets.some((owned) => owned.id === ticket.id)
      ).length,
      0,
      "An actor never lists another actor's tickets."
    );
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        loadTicketForActor(transaction, {
          actor: { guestSessionId: "ticket-stranger" },
          ticketId: paidTickets[0]!.id,
        })
      ),
      (error: unknown) => error instanceof TicketNotFoundError,
      "An actor never loads another actor's ticket."
    );

    // Rotation mints a fresh bearer and invalidates the prior credential.
    const rotatingTicketId = paidTickets[0]!.id;
    const placeholderHash = (
      await pool.query<{ hash: string }>(
        `SELECT "qr_token_hash" AS "hash" FROM "tickets" WHERE "id" = $1`,
        [rotatingTicketId]
      )
    ).rows[0]!.hash;
    const firstToken = `first-bearer-${randomUUID()}`;
    const firstRotation = await withDatabaseTransaction(pool, (transaction) =>
      rotateTicketQrToken(transaction, {
        actor: { guestSessionId: "finalize-paid" },
        ticketId: rotatingTicketId,
        tokenHash: hashQrToken(firstToken),
      })
    );
    assert.equal(firstRotation.outcome, "rotated");
    const afterFirst = (
      await pool.query<{ hash: string; rotated: Date | null }>(
        `SELECT "qr_token_hash" AS "hash", "qr_rotated_at" AS "rotated"
         FROM "tickets" WHERE "id" = $1`,
        [rotatingTicketId]
      )
    ).rows[0]!;
    assert.equal(afterFirst.hash, hashQrToken(firstToken));
    assert.notEqual(
      afterFirst.hash,
      placeholderHash,
      "Rotation replaces the placeholder hash."
    );
    assert.notEqual(afterFirst.rotated, null, "Rotation stamps qr_rotated_at.");

    const secondToken = `second-bearer-${randomUUID()}`;
    await withDatabaseTransaction(pool, (transaction) =>
      rotateTicketQrToken(transaction, {
        actor: { guestSessionId: "finalize-paid" },
        ticketId: rotatingTicketId,
        tokenHash: hashQrToken(secondToken),
      })
    );
    const afterSecond = (
      await pool.query<{ hash: string }>(
        `SELECT "qr_token_hash" AS "hash" FROM "tickets" WHERE "id" = $1`,
        [rotatingTicketId]
      )
    ).rows[0]!;
    assert.equal(afterSecond.hash, hashQrToken(secondToken));
    assert.notEqual(
      afterSecond.hash,
      hashQrToken(firstToken),
      "A new bearer invalidates the prior bearer's stored hash."
    );

    // A stranger cannot rotate; a voided ticket carries no live credential.
    await assert.rejects(
      withDatabaseTransaction(pool, (transaction) =>
        rotateTicketQrToken(transaction, {
          actor: { guestSessionId: "ticket-stranger" },
          ticketId: rotatingTicketId,
          tokenHash: hashQrToken("stranger-bearer"),
        })
      ),
      (error: unknown) => error instanceof TicketNotFoundError,
      "A stranger cannot rotate another actor's ticket."
    );
    await pool.query(`UPDATE "tickets" SET "status" = 'void' WHERE "id" = $1`, [
      paidTickets[1]!.id,
    ]);
    const voidRotation = await withDatabaseTransaction(pool, (transaction) =>
      rotateTicketQrToken(transaction, {
        actor: { guestSessionId: "finalize-paid" },
        ticketId: paidTickets[1]!.id,
        tokenHash: hashQrToken("void-bearer"),
      })
    );
    assert.deepEqual(voidRotation, { outcome: "not_active", status: "void" });

    // General admission finalizes by moving reserved quantity to sold.
    const gaCheckoutEvent = randomUUID();
    const gaCheckoutType = randomUUID();
    await pool.query(
      `INSERT INTO "events" ("id", "organization_id", "venue_id", "title")
       VALUES ($1, $2, $3, 'GA Checkout')`,
      [gaCheckoutEvent, seededOrganizationId, seededVenueId]
    );
    await pool.query(
      `INSERT INTO "ticket_types"
         ("id", "event_id", "name", "kind", "section_name",
          "price_minor", "fee_minor", "capacity", "position")
       VALUES ($1, $2, 'Floor', 'general_admission', 'Floor', 1500, 100, 10, 0)`,
      [gaCheckoutType, gaCheckoutEvent]
    );
    const gaCheckoutHold = await withDatabaseTransaction(pool, (transaction) =>
      createGeneralAdmissionHold(transaction, {
        actor: { guestSessionId: "ga-checkout" },
        eventId: gaCheckoutEvent,
        idempotencyKey: "ga-checkout",
        items: [{ quantity: 3, ticketTypeId: gaCheckoutType }],
      })
    );
    const gaCheckoutOrder = await withDatabaseTransaction(pool, (transaction) =>
      createOrderForHold(transaction, {
        actor: { guestSessionId: "ga-checkout" },
        holdId: gaCheckoutHold.id,
        provider: "fake",
      })
    );
    assert.equal(gaCheckoutOrder.totalMinor, 4_800);
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_ga_secret",
        orderId: gaCheckoutOrder.id,
        providerPaymentIntentId: "pi_ga",
      })
    );
    const gaOutcome = await withDatabaseTransaction(pool, (transaction) =>
      finalizeOrderPayment(transaction, {
        amountMinor: 4_800,
        currency: "USD",
        providerPaymentIntentId: "pi_ga",
      })
    );
    assert.equal(gaOutcome.outcome, "paid");
    const gaCounters = await pool.query<{
      reserved: number;
      sold: number;
      tickets: number;
    }>(
      `SELECT "reserved_quantity" AS "reserved", "sold_quantity" AS "sold",
         (SELECT count(*)::int FROM "tickets" t
          WHERE t."order_id" = $2 AND t."status" = 'active') AS "tickets"
       FROM "ticket_types" WHERE "id" = $1`,
      [gaCheckoutType, gaCheckoutOrder.id]
    );
    assert.deepEqual(gaCounters.rows[0], { reserved: 0, sold: 3, tickets: 3 });

    // Grace: a hold released after expiry still delivers when every unit is
    // reattachable at finalization time.
    const graceFixture = await createCheckoutOrder({
      actorKey: "grace-late",
      seatCount: 1,
    });
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_grace_secret",
        orderId: graceFixture.orderId,
        providerPaymentIntentId: "pi_grace",
      })
    );
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 hour'
       WHERE "id" = $1`,
      [graceFixture.holdId]
    );
    await withDatabaseTransaction(pool, (transaction) =>
      expireHold(transaction, graceFixture.holdId)
    );
    const graceSeat = await pool.query<{ status: string }>(
      `SELECT "status" FROM "event_seats" WHERE "id" = $1`,
      [graceFixture.seatIds[0]!]
    );
    assert.equal(graceSeat.rows[0]?.status, "available");
    const graceOutcome = await withDatabaseTransaction(pool, (transaction) =>
      finalizeOrderPayment(transaction, {
        amountMinor: graceFixture.totalMinor,
        currency: "USD",
        providerPaymentIntentId: "pi_grace",
      })
    );
    assert.equal(
      graceOutcome.outcome,
      "paid",
      "A late success re-secures released inventory when it is still free."
    );

    // Conflict: inventory lost to a rival compensates with a full refund and
    // never substitutes seats or touches the rival's hold.
    const conflictFixture = await createCheckoutOrder({
      actorKey: "conflict-loser",
      seatCount: 1,
    });
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_conflict_secret",
        orderId: conflictFixture.orderId,
        providerPaymentIntentId: "pi_conflict",
      })
    );
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 hour'
       WHERE "id" = $1`,
      [conflictFixture.holdId]
    );
    await withDatabaseTransaction(pool, (transaction) =>
      expireHold(transaction, conflictFixture.holdId)
    );
    const rivalHold = await withDatabaseTransaction(pool, (transaction) =>
      createAssignedSeatHold(transaction, {
        actor: { guestSessionId: "conflict-rival" },
        eventId: conflictFixture.eventId,
        idempotencyKey: "conflict-rival",
        seatIds: conflictFixture.seatIds,
      })
    );
    const conflictOutcome = await withDatabaseTransaction(pool, (transaction) =>
      finalizeOrderPayment(transaction, {
        amountMinor: conflictFixture.totalMinor,
        currency: "USD",
        providerPaymentIntentId: "pi_conflict",
      })
    );
    assert.equal(conflictOutcome.outcome, "conflict");
    const conflictState = await pool.query<{
      order_status: string;
      rival_holds_seat: boolean;
      tickets: number;
    }>(
      `SELECT
         (SELECT o."status"::text FROM "orders" o WHERE o."id" = $1)
           AS "order_status",
         (SELECT count(*)::int FROM "tickets" t WHERE t."order_id" = $1)
           AS "tickets",
         (SELECT s."hold_id" = $3 FROM "event_seats" s WHERE s."id" = $2)
           AS "rival_holds_seat"`,
      [conflictFixture.orderId, conflictFixture.seatIds[0]!, rivalHold.id]
    );
    assert.deepEqual(conflictState.rows[0], {
      order_status: "payment_conflict",
      rival_holds_seat: true,
      tickets: 0,
    });
    const compensation = await loadCompensationTarget(
      pool,
      conflictFixture.orderId
    );
    assert.equal(compensation.providerPaymentIntentId, "pi_conflict");
    await withDatabaseTransaction(pool, (transaction) =>
      applyRefundResult(transaction, {
        orderId: conflictFixture.orderId,
        providerRefundId: "re_conflict",
        settled: true,
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      applyRefundResult(transaction, {
        orderId: conflictFixture.orderId,
        providerRefundId: "re_conflict",
        settled: true,
      })
    );
    const refundedState = await pool.query<{
      order_status: string;
      payment_status: string;
    }>(
      `SELECT o."status"::text AS "order_status",
              p."status"::text AS "payment_status"
       FROM "orders" o JOIN "payments" p ON p."order_id" = o."id"
       WHERE o."id" = $1`,
      [conflictFixture.orderId]
    );
    assert.deepEqual(refundedState.rows[0], {
      order_status: "refunded",
      payment_status: "refunded",
    });

    // A failed attempt records its code and leaves the order open; once the
    // order is final the late failure changes nothing.
    const failureRecord = await withDatabaseTransaction(pool, (transaction) =>
      recordPaymentFailure(transaction, {
        failureCode: "card_declined",
        providerPaymentIntentId: "pi_int_1",
      })
    );
    assert.deepEqual(failureRecord, {
      orderId: racedOrderId,
      recorded: true,
    });
    const lateFailure = await withDatabaseTransaction(pool, (transaction) =>
      recordPaymentFailure(transaction, {
        failureCode: "card_declined",
        providerPaymentIntentId: "pi_paid",
      })
    );
    assert.equal(lateFailure.recorded, false);

    // Concurrent duplicate webhook deliveries record one durable receipt.
    const webhookDeliveries = await Promise.all(
      Array.from({ length: 5 }, () =>
        withDatabaseTransaction(pool, (transaction) =>
          recordWebhookEvent(transaction, {
            payload: { id: "evt_race" },
            provider: "fake",
            providerEventId: "evt_race",
            type: "payment_intent.succeeded",
          })
        )
      )
    );
    assert.equal(
      new Set(webhookDeliveries.map((delivery) => delivery.id)).size,
      1,
      "Duplicate deliveries resolve to one webhook receipt."
    );
    assert.equal(
      webhookDeliveries.filter((delivery) => !delivery.replayed).length,
      1
    );

    // The sweep leaves a checkout-started hold alone until the payment grace
    // window passes, then frees its inventory.
    const graceSweep = await createCheckoutOrder({
      actorKey: "grace-sweep",
      seatCount: 1,
    });
    await pool.query(
      `UPDATE "holds" SET "expires_at" = clock_timestamp() - interval '1 minute'
       WHERE "id" = $1`,
      [graceSweep.holdId]
    );
    await expireDueHolds(pool, { limit: 100 });
    const withinGrace = await pool.query<{ status: string }>(
      `SELECT "status" FROM "holds" WHERE "id" = $1`,
      [graceSweep.holdId]
    );
    assert.equal(
      withinGrace.rows[0]?.status,
      "checkout_started",
      "A checkout-started hold survives the sweep inside the grace window."
    );
    await pool.query(
      `UPDATE "holds"
       SET "expires_at" = clock_timestamp()
         - make_interval(secs => $2::int + 60)
       WHERE "id" = $1`,
      [graceSweep.holdId, CHECKOUT_GRACE_SECONDS]
    );
    await expireDueHolds(pool, { limit: 100 });
    const pastGrace = await pool.query<{
      seat_status: string;
      status: string;
    }>(
      `SELECT h."status"::text AS "status",
              (SELECT s."status"::text FROM "event_seats" s
               WHERE s."id" = $2) AS "seat_status"
       FROM "holds" h WHERE h."id" = $1`,
      [graceSweep.holdId, graceSweep.seatIds[0]!]
    );
    assert.deepEqual(pastGrace.rows[0], {
      seat_status: "available",
      status: "expired",
    });

    // Scanner check-in: an accepted admission is an atomic locked transition,
    // every attempt appends to scan history, and reversal restores the ticket
    // without rewriting that history.
    const scanDevice = "itest-scan-device-0001";
    const scanFixture = await createCheckoutOrder({
      actorKey: "scan-buyer",
      seatCount: 2,
    });
    await withDatabaseTransaction(pool, (transaction) =>
      attachPaymentIntent(transaction, {
        clientSecret: "pi_scan_secret",
        orderId: scanFixture.orderId,
        providerPaymentIntentId: "pi_scan",
      })
    );
    await withDatabaseTransaction(pool, (transaction) =>
      finalizeOrderPayment(transaction, {
        amountMinor: scanFixture.totalMinor,
        currency: "USD",
        providerPaymentIntentId: "pi_scan",
      })
    );
    const scanTickets = await withDatabaseTransaction(pool, (transaction) =>
      listTicketsForActor(transaction, {
        actor: { guestSessionId: "scan-buyer" },
      })
    );
    assert.equal(scanTickets.length, 2);
    const admissionTicket = scanTickets[0]!;
    const spareTicket = scanTickets[1]!;
    const scanBearer = `scan-bearer-${randomUUID()}`;
    await withDatabaseTransaction(pool, (transaction) =>
      rotateTicketQrToken(transaction, {
        actor: { guestSessionId: "scan-buyer" },
        ticketId: admissionTicket.id,
        tokenHash: hashQrToken(scanBearer),
      })
    );
    const scanAt = (eventId: string, credential: ScanCredential) =>
      withDatabaseTransaction(pool, (transaction) =>
        checkInTicket(transaction, {
          actorUserId: seededUserId,
          credential,
          deviceId: scanDevice,
          eventId,
          organizationId: seededOrganizationId,
        })
      );
    const qrCredential: ScanCredential = {
      kind: "qr",
      tokenHash: hashQrToken(scanBearer),
    };

    // An unknown bearer is invalid and never references a ticket.
    const unknownScan = await scanAt(scanFixture.eventId, {
      kind: "qr",
      tokenHash: hashQrToken(`unknown-${randomUUID()}`),
    });
    assert.equal(unknownScan.result, "invalid");
    assert.equal(unknownScan.ticket, null);

    // Concurrent scans of one ticket admit exactly once.
    const scanRace = await Promise.all([
      scanAt(scanFixture.eventId, qrCredential),
      scanAt(scanFixture.eventId, qrCredential),
    ]);
    assert.deepEqual(
      scanRace.map((outcome) => outcome.result).sort(),
      ["accepted", "duplicate"],
      "Concurrent scans produce exactly one accepted check-in."
    );
    const acceptedScan = scanRace.find(
      (outcome) => outcome.result === "accepted"
    )!;
    assert.equal(
      acceptedScan.ticket?.publicNumber,
      admissionTicket.publicNumber
    );
    assert.notEqual(acceptedScan.ticket?.checkedInAt, null);
    const checkedInState = await pool.query<{
      checked_in_at: Date | null;
      status: string;
    }>(
      `SELECT "status"::text AS "status", "checked_in_at"
       FROM "tickets" WHERE "id" = $1`,
      [admissionTicket.id]
    );
    assert.equal(checkedInState.rows[0]?.status, "checked_in");
    assert.notEqual(checkedInState.rows[0]?.checked_in_at, null);

    // The manual public-number fallback resolves the same ticket.
    const manualDuplicate = await scanAt(scanFixture.eventId, {
      kind: "public_number",
      publicNumber: admissionTicket.publicNumber,
    });
    assert.equal(manualDuplicate.result, "duplicate");

    // Reversal restores the ticket and appends to history without rewriting.
    const scansBeforeReversal = await pool.query<{ result: string }>(
      `SELECT "result"::text AS "result" FROM "scans" WHERE "ticket_id" = $1`,
      [admissionTicket.id]
    );
    const reversal = await withDatabaseTransaction(pool, (transaction) =>
      reverseCheckIn(transaction, {
        actorUserId: seededUserId,
        deviceId: scanDevice,
        eventId: scanFixture.eventId,
        organizationId: seededOrganizationId,
        reason: "Accidental double scan at the door.",
        ticketId: admissionTicket.id,
      })
    );
    assert.equal(reversal.outcome, "reversed");
    const scansAfterReversal = await pool.query<{ result: string }>(
      `SELECT "result"::text AS "result" FROM "scans"
       WHERE "ticket_id" = $1 ORDER BY "created_at" ASC, "id" ASC`,
      [admissionTicket.id]
    );
    assert.equal(
      scansAfterReversal.rows.length,
      scansBeforeReversal.rows.length + 1,
      "Reversal appends one row and deletes nothing."
    );
    assert.equal(
      scansAfterReversal.rows.filter((row) => row.result === "accepted").length,
      1,
      "The original accepted scan survives the reversal."
    );
    const restoredState = await pool.query<{
      checked_in_at: Date | null;
      status: string;
    }>(
      `SELECT "status"::text AS "status", "checked_in_at"
       FROM "tickets" WHERE "id" = $1`,
      [admissionTicket.id]
    );
    assert.deepEqual(restoredState.rows[0], {
      checked_in_at: null,
      status: "active",
    });

    // Reversing a ticket that is not checked in reports the state.
    const reversalNoop = await withDatabaseTransaction(pool, (transaction) =>
      reverseCheckIn(transaction, {
        actorUserId: seededUserId,
        deviceId: scanDevice,
        eventId: scanFixture.eventId,
        organizationId: seededOrganizationId,
        reason: "Nothing to reverse here.",
        ticketId: admissionTicket.id,
      })
    );
    assert.deepEqual(reversalNoop, {
      outcome: "not_checked_in",
      status: "active",
    });

    // A reversed ticket admits again.
    const readmission = await scanAt(scanFixture.eventId, {
      kind: "public_number",
      publicNumber: admissionTicket.publicNumber,
    });
    assert.equal(readmission.result, "accepted");

    // A ticket for another event of the same organization fails explicitly
    // and surfaces its own event title to staff.
    const otherEventFixture = await createCheckoutOrder({
      actorKey: "scan-other-event",
      seatCount: 1,
    });
    const wrongEventScan = await scanAt(otherEventFixture.eventId, {
      kind: "public_number",
      publicNumber: spareTicket.publicNumber,
    });
    assert.equal(wrongEventScan.result, "wrong_event");
    assert.equal(wrongEventScan.ticket?.eventTitle, spareTicket.eventTitle);

    // Void, refunded, and expired tickets never admit.
    await pool.query(`UPDATE "tickets" SET "status" = 'void' WHERE "id" = $1`, [
      spareTicket.id,
    ]);
    const voidScan = await scanAt(scanFixture.eventId, {
      kind: "public_number",
      publicNumber: spareTicket.publicNumber,
    });
    assert.equal(voidScan.result, "void");
    await pool.query(
      `UPDATE "tickets" SET "status" = 'refunded' WHERE "id" = $1`,
      [spareTicket.id]
    );
    const refundedScan = await scanAt(scanFixture.eventId, {
      kind: "public_number",
      publicNumber: spareTicket.publicNumber,
    });
    assert.equal(refundedScan.result, "refunded");
    await pool.query(
      `UPDATE "tickets" SET "status" = 'active' WHERE "id" = $1`,
      [spareTicket.id]
    );
    await pool.query(
      `UPDATE "events"
       SET "ends_at" = clock_timestamp() - interval '1 hour'
       WHERE "id" = $1`,
      [scanFixture.eventId]
    );
    const expiredScan = await scanAt(scanFixture.eventId, {
      kind: "public_number",
      publicNumber: spareTicket.publicNumber,
    });
    assert.equal(expiredScan.result, "expired");

    // Another organization scanning the same bearer learns nothing: the scan
    // is invalid and its history row references no ticket.
    const foreignOrgId = randomUUID();
    const foreignEventId = randomUUID();
    await pool.query(
      `INSERT INTO "organizations" ("id", "name", "slug")
       VALUES ($1, 'Foreign Scan Org', $2)`,
      [foreignOrgId, `foreign-scan-org-${foreignOrgId.slice(0, 8)}`]
    );
    await pool.query(
      `INSERT INTO "events" ("id", "organization_id", "venue_id", "title")
       VALUES ($1, $2, $3, 'Foreign Event')`,
      [foreignEventId, foreignOrgId, seededVenueId]
    );
    const crossTenantScan = await withDatabaseTransaction(pool, (transaction) =>
      checkInTicket(transaction, {
        actorUserId: seededUserId,
        credential: qrCredential,
        deviceId: scanDevice,
        eventId: foreignEventId,
        organizationId: foreignOrgId,
      })
    );
    assert.equal(crossTenantScan.result, "invalid");
    assert.equal(crossTenantScan.ticket, null);
    const crossTenantRow = await pool.query<{ ticket_id: string | null }>(
      `SELECT "ticket_id" FROM "scans" WHERE "organization_id" = $1`,
      [foreignOrgId]
    );
    assert.deepEqual(crossTenantRow.rows, [{ ticket_id: null }]);

    // Recent activity lists the event's attempts newest first with actor
    // attribution, and the reversal keeps its reason.
    const recentActivity = await withDatabaseTransaction(pool, (transaction) =>
      listRecentScans(transaction, {
        eventId: scanFixture.eventId,
        limit: 20,
        organizationId: seededOrganizationId,
      })
    );
    assert.equal(recentActivity.length, 9);
    assert.equal(recentActivity[0]?.result, "expired");
    const reversedEntry = recentActivity.find(
      (entry) => entry.result === "reversed"
    )!;
    assert.equal(reversedEntry.reason, "Accidental double scan at the door.");
    assert.equal(reversedEntry.actorEmail, "owner@example.test");
    assert.equal(
      reversedEntry.ticketPublicNumber,
      admissionTicket.publicNumber
    );

    // Check-in and reversal audit in the same transaction, and no raw bearer
    // reaches the scan history or the audit trail.
    const scanAudit = await pool.query<{ action: string; detail: string }>(
      `SELECT "action", "detail"::text AS "detail" FROM "audit_logs"
       WHERE "target_id" = $1 ORDER BY "created_at" ASC`,
      [admissionTicket.id]
    );
    assert.deepEqual(
      scanAudit.rows.map((row) => row.action),
      ["ticket.checked_in", "ticket.checkin_reversed", "ticket.checked_in"]
    );
    for (const row of scanAudit.rows) {
      assert.ok(
        !row.detail.includes(scanBearer),
        "Audit detail never carries a raw QR bearer."
      );
    }

    process.stdout.write(
      `${JSON.stringify({
        assignedSeatHolds: "verified",
        atomicOutbox: "verified",
        authLifecycle: "verified",
        concurrentClaims: claimedIds.length,
        deadLetters: metrics.deadLetter,
        discovery: "verified",
        event: "integration.completed",
        eventPublishing: "verified",
        generalAdmissionHolds: "verified",
        idempotentCheckout: "verified",
        migrations: "applied",
        paymentFinalization: "verified",
        redis: "isolated",
        refunds: "verified",
        scannerCheckIn: "verified",
        schedules: "verified",
        seedDomainRecords: 27,
        seedOutboxEvents: 1,
        venueLayouts: "verified",
        webhookDeduplication: "verified",
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
