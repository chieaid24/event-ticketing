// realistic walkthrough dataset; needs an empty migrated database
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const localDatabaseUrl =
  "postgresql://event_ticketing:example-local-only-password@127.0.0.1:5432/event_ticketing?schema=public";
const databaseUrl = process.env["DATABASE_URL"] ?? localDatabaseUrl;

const parsedUrl = new URL(databaseUrl);
const schema = parsedUrl.searchParams.get("schema") ?? "public";

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
  throw new Error("DATABASE_URL contains an invalid schema name.");
}

const webBaseUrl = process.env["WEB_BASE_URL"] ?? "http://127.0.0.1:3000";
const paymentProvider =
  process.env["PAYMENT_PROVIDER"] === "stripe" ? "stripe" : "fake";
const stripeSecretKey = process.env["STRIPE_SECRET_KEY"];
// live intents make the primary customer's orders refundable through stripe
const liveStripe = paymentProvider === "stripe" && Boolean(stripeSecretKey);

// every demo account signs in with demo-password-2026
const demoPasswordHash =
  "$argon2id$v=19$m=19456,p=1,t=2$YF+iLmamJVYOlxjJN7loNg" +
  "$GI81GYtVT/1XfzrNoxB5VFk/SyqpQ7pgIe3KjFYA+/E";

const ORGANIZATION_SLUG = "harbourlight-presents";
const CURRENCY = "CAD";

// deterministic ids keep urls stable across reseeds
function uuid(name) {
  const hex = createHash("sha256")
    .update(`event-ticketing-demo:${name}`)
    .digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260925);
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (items) => items[Math.floor(random() * items.length)];

function randomString(alphabet, length) {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return out;
}

const ORDER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HEX_UPPER = "0123456789ABCDEF";
const HEX_LOWER = "0123456789abcdef";
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const usedNumbers = new Set();

function uniqueNumber(prefix, alphabet, length) {
  for (;;) {
    const candidate = `${prefix}${randomString(alphabet, length)}`;
    if (!usedNumbers.has(candidate)) {
      usedNumbers.add(candidate);
      return candidate;
    }
  }
}

const orderNumber = () => uniqueNumber("ET-", ORDER_ALPHABET, 12);
const ticketNumber = () => uniqueNumber("TK-", HEX_UPPER, 12);
const qrTokenHash = () =>
  createHash("sha256").update(randomBytes(32)).digest("hex");

function providerIntentId() {
  return paymentProvider === "stripe"
    ? `pi_3${randomString(ALNUM, 24)}`
    : `pi_fake_${randomString(HEX_LOWER, 24)}`;
}

function providerRefundId() {
  return paymentProvider === "stripe"
    ? `re_3${randomString(ALNUM, 24)}`
    : `re_fake_${randomString(HEX_LOWER, 24)}`;
}

function providerEventId() {
  return paymentProvider === "stripe"
    ? `evt_3${randomString(ALNUM, 24)}`
    : `evt_fake_${randomString(HEX_LOWER, 24)}`;
}

const now = new Date();
const today = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
);

function at(dayOffset, hour = 0, minute = 0) {
  const minutes = (dayOffset * 24 + hour) * 60 + minute;
  return new Date(today.getTime() + minutes * 60_000);
}

const plus = (date, seconds) => new Date(date.getTime() + seconds * 1000);
const minutesBefore = (date, minutes) => plus(date, -minutes * 60);

function randomBetween(from, to) {
  const start = from.getTime();
  const end = Math.max(start + 60_000, to.getTime());
  return new Date(start + random() * (end - start));
}

function money(minor) {
  return `${(minor / 100).toFixed(2)} ${CURRENCY}`;
}

const client = new pg.Client({ connectionString: databaseUrl });

async function insert(table, row) {
  const keys = Object.keys(row);
  const columns = keys.map((key) => `"${key}"`).join(", ");
  const params = keys.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `INSERT INTO "${table}" (${columns}) VALUES (${params})`,
    keys.map((key) => row[key])
  );
}

async function update(table, id, patch) {
  const keys = Object.keys(patch);
  const assignments = keys
    .map((key, index) => `"${key}" = $${index + 2}`)
    .join(", ");
  await client.query(`UPDATE "${table}" SET ${assignments} WHERE "id" = $1`, [
    id,
    ...keys.map((key) => patch[key]),
  ]);
}

// ---------------------------------------------------------------------------
// people

const staffSpecs = [
  ["maya", "maya.chen@harbourlight.test", "owner"],
  ["daniel", "daniel.okafor@harbourlight.test", "admin"],
  ["priya", "priya.raman@harbourlight.test", "event_manager"],
  ["lucas", "lucas.moreau@harbourlight.test", "finance"],
  ["sam", "sam.whitfield@harbourlight.test", "scanner"],
  ["avery", "avery.brooks@harbourlight.test", "viewer"],
];

const customerEmails = [
  "amara.osei",
  "ben.tanaka",
  "chloe.dubois",
  "diego.fernandez",
  "elena.petrova",
  "farah.nasser",
  "gabriel.silva",
  "hannah.kim",
  "isaac.cohen",
  "julia.novak",
  "kwame.mensah",
  "leila.hassan",
  "marco.rossi",
  "nadia.ali",
  "oliver.grant",
  "paulina.wojcik",
  "quinn.murphy",
  "rafael.ortiz",
  "sofia.lindgren",
  "tomas.horvath",
  "uma.krishnan",
  "victor.nguyen",
  "wren.abbott",
  "yasmin.farouk",
  "zane.holloway",
].map((local) => [local.split(".")[0], `${local}@example.test`]);

const users = new Map();

async function createUser(key, email, options = {}) {
  const id = uuid(`user:${key}`);
  const createdAt = options.createdAt ?? at(-randomInt(245, 300), 14);
  const verified = options.verified ?? true;
  await insert("users", {
    id,
    email,
    password_hash: demoPasswordHash,
    platform_role: "customer",
    status: verified ? "active" : "pending",
    email_verified_at: verified ? plus(createdAt, 240) : null,
    created_at: createdAt,
    updated_at: verified ? plus(createdAt, 240) : createdAt,
  });
  await outbox({
    key: `verification:${key}`,
    topic: "auth.email.verification.requested",
    payload: { userId: id },
    aggregateType: "user",
    aggregateId: id,
    createdAt,
    completedAt: plus(createdAt, 2),
  });
  const user = { email, id, key };
  users.set(key, user);
  return user;
}

// ---------------------------------------------------------------------------
// outbox, notifications, audit

async function outbox({
  key,
  topic,
  payload,
  aggregateType = null,
  aggregateId = null,
  deduplicationKey = null,
  status = "completed",
  createdAt,
  availableAt = createdAt,
  completedAt = null,
  attemptCount = status === "pending" ? 0 : 1,
  maxAttempts = 8,
  lastErrorCode = null,
  deadLetteredAt = null,
}) {
  const updatedAt = completedAt ?? deadLetteredAt ?? createdAt;
  await insert("outbox_events", {
    id: uuid(`outbox:${key}`),
    topic,
    payload,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    deduplication_key: deduplicationKey,
    status,
    available_at: availableAt,
    attempt_count: attemptCount,
    max_attempts: maxAttempts,
    last_error_code: lastErrorCode,
    completed_at: completedAt,
    dead_lettered_at: deadLetteredAt,
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

async function notify({
  key,
  order,
  kind,
  deduplicationKey,
  subject,
  text,
  createdAt,
  delivery = "sent",
  sentAt = plus(createdAt, 3),
  suppressedAt = null,
  suppressionCode = null,
  availableAt = createdAt,
}) {
  const id = uuid(`notification:${key}`);
  const base = {
    id,
    order_id: order.id,
    user_id: order.customer.id,
    kind,
    recipient_email: order.customer.email,
    deduplication_key: deduplicationKey,
    payload: { subject, text },
    created_at: createdAt,
  };
  const outboxBase = {
    key: `notification:${key}`,
    topic: "notification.send",
    payload: { notificationId: id },
    aggregateType: "notification",
    aggregateId: id,
    deduplicationKey: `notification.send:${id}`,
    createdAt,
    availableAt,
  };
  if (delivery === "sent") {
    await insert("notifications", {
      ...base,
      status: "sent",
      attempt_count: 1,
      sent_at: sentAt,
      updated_at: sentAt,
    });
    await outbox({ ...outboxBase, completedAt: sentAt });
  } else if (delivery === "queued") {
    await insert("notifications", {
      ...base,
      status: "queued",
      attempt_count: 0,
      updated_at: createdAt,
    });
    await outbox({ ...outboxBase, status: "pending" });
  } else if (delivery === "suppressed") {
    await insert("notifications", {
      ...base,
      status: "suppressed",
      attempt_count: 0,
      last_error_code: suppressionCode,
      suppressed_at: suppressedAt,
      updated_at: suppressedAt,
    });
    const future = availableAt > now;
    await outbox({
      ...outboxBase,
      status: future ? "pending" : "completed",
      completedAt: future ? null : availableAt,
    });
  } else if (delivery === "dead_letter") {
    const deadAt = plus(createdAt, 4 * 60 + 10);
    await insert("notifications", {
      ...base,
      status: "failed",
      attempt_count: 8,
      last_error_code: "email_send_failed",
      updated_at: deadAt,
    });
    await outbox({
      ...outboxBase,
      status: "dead_letter",
      attemptCount: 8,
      lastErrorCode: "email_send_failed",
      deadLetteredAt: deadAt,
    });
  }
  return id;
}

async function audit({
  key,
  organizationId,
  actor,
  action,
  targetType,
  targetId,
  detail,
  createdAt,
}) {
  await insert("audit_logs", {
    id: uuid(`audit:${key}`),
    organization_id: organizationId,
    actor_user_id: actor?.id ?? null,
    action,
    target_type: targetType,
    target_id: targetId,
    detail,
    created_at: createdAt,
  });
}

// ---------------------------------------------------------------------------
// organizations, venues, events

async function createOrganization({ key, name, slug, owner, createdAt }) {
  const id = uuid(`organization:${key}`);
  await insert("organizations", {
    id,
    name,
    slug,
    version: 1,
    created_at: createdAt,
    updated_at: createdAt,
  });
  await insert("organization_memberships", {
    id: uuid(`membership:${key}:${owner.key}`),
    organization_id: id,
    user_id: owner.id,
    role: "owner",
    status: "active",
    joined_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
  });
  await audit({
    key: `organization.created:${key}`,
    organizationId: id,
    actor: owner,
    action: "organization.created",
    targetType: "organization",
    targetId: id,
    detail: { name, slug },
    createdAt,
  });
  await outbox({
    key: `organization.created:${key}`,
    topic: "organization.created",
    payload: { organizationId: id },
    aggregateType: "organization",
    aggregateId: id,
    deduplicationKey: `organization.created:${id}`,
    createdAt,
    completedAt: plus(createdAt, 1),
  });
  return { id, key, name, slug };
}

async function addMember({
  organization,
  user,
  role,
  invitedBy,
  invitedAt,
  joined = true,
}) {
  const id = uuid(`membership:${organization.key}:${user.key}`);
  const joinedAt = joined ? plus(invitedAt, randomInt(600, 7200)) : null;
  await insert("organization_memberships", {
    id,
    organization_id: organization.id,
    user_id: user.id,
    role,
    status: joined ? "active" : "invited",
    invited_by_id: invitedBy.id,
    joined_at: joinedAt,
    created_at: invitedAt,
    updated_at: joinedAt ?? invitedAt,
  });
  await audit({
    key: `member.invited:${organization.key}:${user.key}`,
    organizationId: organization.id,
    actor: invitedBy,
    action: "member.invited",
    targetType: "membership",
    targetId: id,
    detail: { role, targetUserId: user.id },
    createdAt: invitedAt,
  });
  if (joined) {
    await audit({
      key: `member.joined:${organization.key}:${user.key}`,
      organizationId: organization.id,
      actor: user,
      action: "member.joined",
      targetType: "membership",
      targetId: id,
      detail: { role, targetUserId: user.id },
      createdAt: joinedAt,
    });
  }
  return { id, role };
}

// rows of unit-spaced seats; gapAfter skips one x column for an aisle
function seatRows({ labels, seatsPerRow, gapAfter = null, access = {} }) {
  return labels.map((label, rowIndex) => ({
    label,
    seats: Array.from({ length: seatsPerRow }, (_, seatIndex) => {
      const number = seatIndex + 1;
      const x = gapAfter !== null && number > gapAfter ? number + 1 : number;
      const flag = access[`${label}-${number}`];
      return {
        label: String(number),
        x,
        y: rowIndex,
        accessible: flag === "accessible",
        companion: flag === "companion",
      };
    }),
  }));
}

async function createVenue({
  key,
  organization,
  name,
  description,
  sections,
  actor,
  createdAt,
}) {
  const id = uuid(`venue:${key}`);
  await insert("venues", {
    id,
    organization_id: organization.id,
    name,
    description,
    version: 2,
    created_at: createdAt,
    updated_at: plus(createdAt, 900),
  });
  let seatCount = 0;
  const layout = {};
  for (const [position, section] of sections.entries()) {
    const sectionId = uuid(`venue-section:${key}:${section.name}`);
    await insert("venue_sections", {
      id: sectionId,
      venue_id: id,
      name: section.name,
      kind: section.kind,
      ga_capacity:
        section.kind === "general_admission" ? section.capacity : null,
      position,
      created_at: createdAt,
    });
    layout[section.name] = section;
    for (const [rowPosition, row] of (section.rows ?? []).entries()) {
      const rowId = uuid(`venue-row:${key}:${section.name}:${row.label}`);
      await insert("venue_rows", {
        id: rowId,
        section_id: sectionId,
        label: row.label,
        position: rowPosition,
        created_at: createdAt,
      });
      for (const seat of row.seats) {
        seatCount += 1;
        await insert("venue_seats", {
          id: uuid(
            `venue-seat:${key}:${section.name}:${row.label}:${seat.label}`
          ),
          row_id: rowId,
          label: seat.label,
          x: seat.x,
          y: seat.y,
          accessible: seat.accessible,
          companion: seat.companion,
          created_at: createdAt,
        });
      }
    }
  }
  await audit({
    key: `venue.created:${key}`,
    organizationId: organization.id,
    actor,
    action: "venue.created",
    targetType: "venue",
    targetId: id,
    detail: { name },
    createdAt,
  });
  await audit({
    key: `venue.layout.replaced:${key}`,
    organizationId: organization.id,
    actor,
    action: "venue.layout.replaced",
    targetType: "venue",
    targetId: id,
    detail: { sectionCount: sections.length, seatCount, version: 2 },
    createdAt: plus(createdAt, 900),
  });
  return { id, key, layout, name };
}

async function createEvent(spec) {
  const id = uuid(`event:${spec.key}`);
  const isDraft = spec.status === "draft";
  const publishedAt = isDraft ? null : spec.publishedAt;
  const createdAt = spec.createdAt ?? plus(spec.publishedAt, -3 * 86400);
  await insert("events", {
    id,
    organization_id: spec.organization.id,
    venue_id: spec.venue.id,
    title: spec.title,
    description: spec.description,
    status: spec.status,
    timezone: "America/Toronto",
    currency: CURRENCY,
    starts_at: spec.startsAt,
    ends_at: spec.endsAt,
    sales_start_at: spec.salesStartAt,
    sales_end_at: spec.salesEndAt ?? spec.startsAt,
    hold_duration_seconds: spec.holdDurationSeconds ?? 600,
    waiting_room_enabled: false,
    refund_policy: spec.refundPolicy ?? null,
    customer_refunds_enabled: spec.customerRefundsEnabled ?? false,
    customer_refund_cutoff_minutes: spec.customerRefundCutoffMinutes ?? 1440,
    inventory_return_cutoff_minutes: 1440,
    media_url: null,
    published_at: publishedAt,
    version: isDraft ? 3 : 5,
    created_at: createdAt,
    updated_at: spec.updatedAt ?? publishedAt ?? createdAt,
  });
  const event = {
    ...spec,
    id,
    holdDurationSeconds: spec.holdDurationSeconds ?? 600,
    currency: CURRENCY,
    types: {},
    seatsBySection: {},
  };
  for (const [position, type] of spec.ticketTypes.entries()) {
    const typeId = uuid(`ticket-type:${spec.key}:${type.name}`);
    await insert("ticket_types", {
      id: typeId,
      event_id: id,
      name: type.name,
      kind: type.kind,
      section_name: type.sectionName,
      price_minor: type.priceMinor,
      fee_minor: type.feeMinor,
      capacity: type.kind === "general_admission" ? type.capacity : null,
      reserved_quantity: 0,
      sold_quantity: 0,
      position,
      created_at: createdAt,
    });
    event.types[type.name] = { ...type, id: typeId };
  }
  let seatCount = 0;
  if (!isDraft) {
    const blocked = new Set(spec.blockedSeats ?? []);
    for (const type of Object.values(event.types)) {
      if (type.kind !== "assigned") {
        continue;
      }
      const section = spec.venue.layout[type.sectionName];
      const rows = [];
      for (const row of section.rows) {
        const seats = [];
        for (const seat of row.seats) {
          const key = `${type.sectionName}|${row.label}|${seat.label}`;
          const seatId = uuid(`event-seat:${spec.key}:${key}`);
          const status = blocked.has(key) ? "blocked" : "available";
          await insert("event_seats", {
            id: seatId,
            event_id: id,
            ticket_type_id: type.id,
            section_name: type.sectionName,
            row_label: row.label,
            seat_label: seat.label,
            x: seat.x,
            y: seat.y,
            accessible: seat.accessible,
            companion: seat.companion,
            price_minor: type.priceMinor,
            status,
            hold_id: null,
            created_at: publishedAt,
          });
          seatCount += 1;
          seats.push({
            id: seatId,
            key,
            label: `${row.label}${seat.label}`,
            priceMinor: type.priceMinor,
            taken: status !== "available",
            type,
          });
        }
        rows.push(seats);
      }
      event.seatsBySection[type.sectionName] = rows;
    }
  }
  const actor = spec.actor;
  await audit({
    key: `event.created:${spec.key}`,
    organizationId: spec.organization.id,
    actor,
    action: "event.created",
    targetType: "event",
    targetId: id,
    detail: { title: spec.title, venueId: spec.venue.id },
    createdAt,
  });
  await audit({
    key: `event.ticket_types.replaced:${spec.key}`,
    organizationId: spec.organization.id,
    actor,
    action: "event.ticket_types.replaced",
    targetType: "event",
    targetId: id,
    detail: { ticketTypeCount: spec.ticketTypes.length, version: 2 },
    createdAt: plus(createdAt, 1800),
  });
  if (!isDraft) {
    await audit({
      key: `event.published:${spec.key}`,
      organizationId: spec.organization.id,
      actor,
      action: "event.published",
      targetType: "event",
      targetId: id,
      detail: { seatCount, ticketTypeCount: spec.ticketTypes.length },
      createdAt: publishedAt,
    });
    await outbox({
      key: `event.published:${spec.key}`,
      topic: "event.published",
      payload: { eventId: id },
      aggregateType: "event",
      aggregateId: id,
      deduplicationKey: `event.published:${id}`,
      createdAt: publishedAt,
      completedAt: plus(publishedAt, 1),
    });
  }
  return event;
}

// contiguous free seats in one randomly chosen row
function takeSeats(event, sectionName, count) {
  const rows = event.seatsBySection[sectionName];
  const order = rows.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  for (const rowIndex of order) {
    const seats = rows[rowIndex];
    for (let start = 0; start + count <= seats.length; start += 1) {
      const run = seats.slice(start, start + count);
      if (run.every((seat) => !seat.taken)) {
        for (const seat of run) {
          seat.taken = true;
        }
        return run;
      }
    }
  }
  return null;
}

function takeSpecificSeats(event, sectionName, labels) {
  const seats = event.seatsBySection[sectionName]
    .flat()
    .filter((seat) => labels.includes(seat.label));
  if (seats.length !== labels.length || seats.some((seat) => seat.taken)) {
    throw new Error(`seats ${labels.join(",")} unavailable in ${sectionName}`);
  }
  for (const seat of seats) {
    seat.taken = true;
  }
  return seats;
}

// ---------------------------------------------------------------------------
// purchases

const liveIntents = new Map();

async function createLiveIntent({ orderId, publicNumber, amountMinor, title }) {
  const body = new URLSearchParams({
    amount: String(amountMinor),
    currency: CURRENCY.toLowerCase(),
    confirm: "true",
    payment_method: "pm_card_visa",
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
    "metadata[orderId]": orderId,
    "metadata[publicNumber]": publicNumber,
    description: `${title} - ${publicNumber}`,
  });
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `demo-seed:${orderId}`,
    },
    body,
  });
  const intent = await response.json();
  if (!response.ok || intent.status !== "succeeded") {
    throw new Error(
      `stripe intent for ${publicNumber} failed: ${JSON.stringify(intent)}`
    );
  }
  return { clientSecret: intent.client_secret, id: intent.id };
}

function quote(event, lines) {
  let subtotal = 0;
  let fee = 0;
  for (const line of lines) {
    const type = event.types[line.type];
    const quantity = line.seats ? line.seats.length : line.quantity;
    subtotal += quantity * type.priceMinor;
    fee += quantity * type.feeMinor;
  }
  return { fee, subtotal, total: subtotal + fee };
}

function confirmationText(order) {
  return [
    `Your payment for ${order.event.title} is confirmed.`,
    `Order ${order.publicNumber} total: ${money(order.total)}.`,
    `View your tickets: ${webBaseUrl}/account/tickets`,
  ].join("\n");
}

function reminderText(order) {
  return [
    `${order.event.title} starts in 24 hours.`,
    `Bring order ${order.publicNumber} to the door: ${webBaseUrl}/account/tickets`,
  ].join("\n");
}

async function purchase({
  key,
  event,
  customer,
  lines,
  startedAt,
  outcome = "paid",
  live = false,
  confirmationDelivery = "sent",
}) {
  const holdId = uuid(`hold:${key}`);
  const orderId = uuid(`order:${key}`);
  const t0 = startedAt;
  const expiresAt = plus(t0, event.holdDurationSeconds);
  await insert("holds", {
    id: holdId,
    event_id: event.id,
    user_id: customer.id,
    guest_session_id: null,
    actor_key: `user:${customer.id}`,
    idempotency_key: uuid(`hold-idempotency:${key}`),
    status: "active",
    expires_at: expiresAt,
    created_at: t0,
    updated_at: t0,
  });
  const items = [];
  for (const line of lines) {
    const type = event.types[line.type];
    if (type.kind === "assigned") {
      for (const seat of line.seats) {
        await insert("hold_items", {
          id: uuid(`hold-item:${key}:${seat.key}`),
          hold_id: holdId,
          ticket_type_id: type.id,
          event_seat_id: seat.id,
          quantity: 1,
          unit_price_minor: seat.priceMinor,
          unit_fee_minor: type.feeMinor,
          created_at: t0,
        });
        await update("event_seats", seat.id, {
          status: "held",
          hold_id: holdId,
        });
        items.push({
          key: seat.key,
          quantity: 1,
          seat,
          type,
          unitFee: type.feeMinor,
          unitPrice: seat.priceMinor,
        });
      }
    } else {
      await insert("hold_items", {
        id: uuid(`hold-item:${key}:${type.name}`),
        hold_id: holdId,
        ticket_type_id: type.id,
        event_seat_id: null,
        quantity: line.quantity,
        unit_price_minor: type.priceMinor,
        unit_fee_minor: type.feeMinor,
        created_at: t0,
      });
      await client.query(
        `UPDATE "ticket_types"
           SET "reserved_quantity" = "reserved_quantity" + $2
         WHERE "id" = $1`,
        [type.id, line.quantity]
      );
      items.push({
        key: type.name,
        quantity: line.quantity,
        seat: null,
        type,
        unitFee: type.feeMinor,
        unitPrice: type.priceMinor,
      });
    }
  }
  const { fee, subtotal, total } = quote(event, lines);
  const t1 = plus(t0, randomInt(30, 90));
  const publicNumber = live ? liveIntents.get(key).publicNumber : orderNumber();
  await insert("orders", {
    id: orderId,
    public_number: publicNumber,
    hold_id: holdId,
    event_id: event.id,
    user_id: customer.id,
    guest_session_id: null,
    actor_key: `user:${customer.id}`,
    status: "pending_payment",
    currency: CURRENCY,
    subtotal_minor: subtotal,
    fee_minor: fee,
    total_minor: total,
    created_at: t1,
    updated_at: t1,
  });
  for (const item of items) {
    item.orderItemId = uuid(`order-item:${key}:${item.key}`);
    await insert("order_items", {
      id: item.orderItemId,
      order_id: orderId,
      ticket_type_id: item.type.id,
      event_seat_id: item.seat?.id ?? null,
      quantity: item.quantity,
      unit_price_minor: item.unitPrice,
      unit_fee_minor: item.unitFee,
      created_at: t1,
    });
  }
  const intent = live
    ? liveIntents.get(key).intent
    : {
        clientSecret: `${providerIntentId()}_secret_${randomString(ALNUM, 24)}`,
        id: null,
      };
  const intentId = intent.id ?? intent.clientSecret.split("_secret_")[0];
  const paymentId = uuid(`payment:${key}`);
  await insert("payments", {
    id: paymentId,
    order_id: orderId,
    provider: paymentProvider,
    provider_payment_intent_id: intentId,
    client_secret: intent.clientSecret,
    amount_minor: total,
    currency: CURRENCY,
    status: "requires_payment",
    created_at: t1,
    updated_at: t1,
  });
  await update("holds", holdId, { status: "checkout_started", updated_at: t1 });

  const order = {
    customer,
    event,
    fee,
    holdId,
    id: orderId,
    items,
    key,
    paymentId,
    publicNumber,
    subtotal,
    total,
  };

  if (outcome === "abandoned") {
    const failedAt = plus(t1, randomInt(40, 120));
    await update("payments", paymentId, {
      last_failure_code: "card_declined",
      last_failure_at: failedAt,
      updated_at: failedAt,
    });
    await outbox({
      key: `payment.intent.failed:${key}`,
      topic: "payment.intent.failed",
      payload: {
        amountMinor: total,
        currency: CURRENCY,
        failureCode: "card_declined",
        providerEventId: providerEventId(),
        providerPaymentIntentId: intentId,
      },
      deduplicationKey: `payment-webhook:${paymentProvider}:${key}:failed`,
      createdAt: failedAt,
      completedAt: plus(failedAt, 1),
    });
    await releaseHold(holdId, items, expiresAt);
    return order;
  }

  const t2 = plus(t1, randomInt(45, 150));
  for (const item of items) {
    if (item.seat) {
      await update("event_seats", item.seat.id, {
        status: "sold",
        hold_id: null,
      });
    } else {
      await client.query(
        `UPDATE "ticket_types"
           SET "reserved_quantity" = "reserved_quantity" - $2,
               "sold_quantity" = "sold_quantity" + $2
         WHERE "id" = $1`,
        [item.type.id, item.quantity]
      );
    }
    item.tickets = [];
    for (let unit = 1; unit <= item.quantity; unit += 1) {
      const ticket = {
        id: uuid(`ticket:${key}:${item.key}:${unit}`),
        item,
        publicNumber: ticketNumber(),
        seat: item.seat,
        status: "active",
      };
      await insert("tickets", {
        id: ticket.id,
        order_id: orderId,
        order_item_id: item.orderItemId,
        event_id: event.id,
        ticket_type_id: item.type.id,
        event_seat_id: item.seat?.id ?? null,
        status: "active",
        public_number: ticket.publicNumber,
        qr_token_hash: qrTokenHash(),
        created_at: t2,
      });
      item.tickets.push(ticket);
    }
  }
  await update("holds", holdId, { status: "consumed", updated_at: t2 });
  await update("orders", orderId, {
    status: "paid",
    paid_at: t2,
    updated_at: t2,
  });
  await update("payments", paymentId, { status: "succeeded", updated_at: t2 });
  order.paidAt = t2;
  await outbox({
    key: `payment.intent.succeeded:${key}`,
    topic: "payment.intent.succeeded",
    payload: {
      amountMinor: total,
      currency: CURRENCY,
      failureCode: null,
      providerEventId: providerEventId(),
      providerPaymentIntentId: intentId,
    },
    deduplicationKey: `payment-webhook:${paymentProvider}:${key}:succeeded`,
    createdAt: t2,
    completedAt: plus(t2, 1),
  });
  await notify({
    key: `order.confirmation:${key}`,
    order,
    kind: "order_confirmation",
    deduplicationKey: `order.confirmation:${orderId}`,
    subject: `Tickets ready for order ${publicNumber}`,
    text: confirmationText(order),
    createdAt: plus(t2, 1),
    delivery: confirmationDelivery,
  });
  const reminderAt = plus(event.startsAt, -86400);
  const reminderSendAt = reminderAt > t2 ? reminderAt : plus(t2, 5);
  if (event.reminders !== "suppressed") {
    await notify({
      key: `event.reminder:${key}`,
      order,
      kind: "event_reminder",
      deduplicationKey: `event.reminder:${orderId}:24h`,
      subject: `${event.title} starts soon`,
      text: reminderText(order),
      createdAt: plus(t2, 1),
      availableAt: reminderSendAt,
      delivery: reminderSendAt > now ? "queued" : "sent",
      sentAt: plus(reminderSendAt, 2),
    });
  } else {
    await notify({
      key: `event.reminder:${key}`,
      order,
      kind: "event_reminder",
      deduplicationKey: `event.reminder:${orderId}:24h`,
      subject: `${event.title} starts soon`,
      text: reminderText(order),
      createdAt: plus(t2, 1),
      availableAt: reminderSendAt,
      delivery: "suppressed",
      suppressedAt: event.cancelledAt,
      suppressionCode: "event_cancelled",
    });
  }
  return order;
}

async function releaseHold(holdId, items, releasedAt) {
  for (const item of items) {
    if (item.seat) {
      await update("event_seats", item.seat.id, {
        status: "available",
        hold_id: null,
      });
      item.seat.taken = false;
    } else {
      await client.query(
        `UPDATE "ticket_types"
           SET "reserved_quantity" = "reserved_quantity" - $2
         WHERE "id" = $1`,
        [item.type.id, item.quantity]
      );
    }
  }
  await update("holds", holdId, { status: "expired", updated_at: releasedAt });
}

// selection that never reached checkout
async function abandonedHold({ key, event, customer, lines, startedAt }) {
  const holdId = uuid(`hold:${key}`);
  const expiresAt = plus(startedAt, event.holdDurationSeconds);
  await insert("holds", {
    id: holdId,
    event_id: event.id,
    user_id: customer.id,
    guest_session_id: null,
    actor_key: `user:${customer.id}`,
    idempotency_key: uuid(`hold-idempotency:${key}`),
    status: "active",
    expires_at: expiresAt,
    created_at: startedAt,
    updated_at: startedAt,
  });
  for (const line of lines) {
    const type = event.types[line.type];
    if (type.kind === "assigned") {
      for (const seat of line.seats) {
        await insert("hold_items", {
          id: uuid(`hold-item:${key}:${seat.key}`),
          hold_id: holdId,
          ticket_type_id: type.id,
          event_seat_id: seat.id,
          quantity: 1,
          unit_price_minor: seat.priceMinor,
          unit_fee_minor: type.feeMinor,
          created_at: startedAt,
        });
        seat.taken = false;
      }
      continue;
    }
    await insert("hold_items", {
      id: uuid(`hold-item:${key}:${type.name}`),
      hold_id: holdId,
      ticket_type_id: type.id,
      event_seat_id: null,
      quantity: line.quantity,
      unit_price_minor: type.priceMinor,
      unit_fee_minor: type.feeMinor,
      created_at: startedAt,
    });
  }
  await update("holds", holdId, { status: "expired", updated_at: expiresAt });
}

// hold still ticking; the worker sweep releases it after expiry
async function activeHold({ key, event, customer, lines, remainingSeconds }) {
  const holdId = uuid(`hold:${key}`);
  const createdAt = plus(now, remainingSeconds - event.holdDurationSeconds);
  await insert("holds", {
    id: holdId,
    event_id: event.id,
    user_id: customer.id,
    guest_session_id: null,
    actor_key: `user:${customer.id}`,
    idempotency_key: uuid(`hold-idempotency:${key}`),
    status: "active",
    expires_at: plus(now, remainingSeconds),
    created_at: createdAt,
    updated_at: createdAt,
  });
  for (const line of lines) {
    const type = event.types[line.type];
    if (type.kind === "assigned") {
      for (const seat of line.seats) {
        await insert("hold_items", {
          id: uuid(`hold-item:${key}:${seat.key}`),
          hold_id: holdId,
          ticket_type_id: type.id,
          event_seat_id: seat.id,
          quantity: 1,
          unit_price_minor: seat.priceMinor,
          unit_fee_minor: type.feeMinor,
          created_at: createdAt,
        });
        await update("event_seats", seat.id, {
          status: "held",
          hold_id: holdId,
        });
      }
    } else {
      await insert("hold_items", {
        id: uuid(`hold-item:${key}:${type.name}`),
        hold_id: holdId,
        ticket_type_id: type.id,
        event_seat_id: null,
        quantity: line.quantity,
        unit_price_minor: type.priceMinor,
        unit_fee_minor: type.feeMinor,
        created_at: createdAt,
      });
      await client.query(
        `UPDATE "ticket_types"
           SET "reserved_quantity" = "reserved_quantity" + $2
         WHERE "id" = $1`,
        [type.id, line.quantity]
      );
    }
  }
}

// ---------------------------------------------------------------------------
// refunds and scans

async function refund({
  key,
  order,
  units,
  initiator,
  actor,
  reason = null,
  requestedAt,
  outcome = "succeeded",
  failureCode = "provider_refund_failed",
}) {
  const refundId = uuid(`refund:${key}`);
  let amount = 0;
  for (const unit of units) {
    amount += unit.tickets.length * (unit.item.unitPrice + unit.item.unitFee);
  }
  await insert("refunds", {
    id: refundId,
    order_id: order.id,
    actor_user_id: actor.id,
    request_key: uuid(`refund-request:${key}`),
    initiator,
    status: "requested",
    reason,
    amount_minor: amount,
    currency: CURRENCY,
    created_at: requestedAt,
    updated_at: requestedAt,
  });
  for (const unit of units) {
    await insert("refund_items", {
      id: uuid(`refund-item:${key}:${unit.item.key}`),
      refund_id: refundId,
      order_item_id: unit.item.orderItemId,
      quantity: unit.tickets.length,
      amount_minor:
        unit.tickets.length * (unit.item.unitPrice + unit.item.unitFee),
      created_at: requestedAt,
    });
  }
  if (initiator === "organizer") {
    await audit({
      key: `refund.requested:${key}`,
      organizationId: order.event.organization.id,
      actor,
      action: "refund.requested",
      targetType: "refund",
      targetId: refundId,
      detail: { amountMinor: amount, orderId: order.id, reason },
      createdAt: requestedAt,
    });
  }
  await outbox({
    key: `refund.requested:${key}`,
    topic: "refund.requested",
    payload: { refundId },
    aggregateType: "refund",
    aggregateId: refundId,
    deduplicationKey: `refund.requested:${refundId}`,
    createdAt: requestedAt,
    completedAt: plus(requestedAt, 2),
  });
  const pendingAt = plus(requestedAt, 2);
  const providerId = providerRefundId();
  await update("refunds", refundId, {
    status: "provider_pending",
    provider_refund_id: providerId,
    updated_at: pendingAt,
  });
  const completedAt = plus(requestedAt, randomInt(20, 90));
  if (outcome === "failed") {
    await update("refunds", refundId, {
      status: "failed",
      provider_failure_code: failureCode,
      completed_at: completedAt,
      updated_at: completedAt,
    });
    await outbox({
      key: `refund.failed:${key}`,
      topic: "refund.failed",
      payload: { refundId },
      aggregateType: "refund",
      aggregateId: refundId,
      deduplicationKey: `refund.failed:${refundId}`,
      createdAt: completedAt,
      completedAt: plus(completedAt, 1),
    });
    await notify({
      key: `refund.failed:${key}`,
      order,
      kind: "refund_failed",
      deduplicationKey: `refund.failed:${refundId}`,
      subject: `Refund failed for order ${order.publicNumber}`,
      text: `The refund of ${money(amount)} for ${order.event.title} could not be completed. Our team is looking into it.`,
      createdAt: plus(completedAt, 1),
    });
    return refundId;
  }
  const returnInventory =
    completedAt < minutesBefore(order.event.startsAt, 1440);
  await update("refunds", refundId, {
    status: "succeeded",
    completed_at: completedAt,
    inventory_returned_at: returnInventory ? completedAt : null,
    updated_at: completedAt,
  });
  for (const unit of units) {
    for (const ticket of unit.tickets) {
      ticket.status = "refunded";
      await update("tickets", ticket.id, { status: "refunded" });
    }
    if (returnInventory) {
      if (unit.item.seat) {
        await update("event_seats", unit.item.seat.id, { status: "available" });
        unit.item.seat.taken = false;
      } else {
        await client.query(
          `UPDATE "ticket_types"
             SET "sold_quantity" = "sold_quantity" - $2
           WHERE "id" = $1`,
          [unit.item.type.id, unit.tickets.length]
        );
      }
    }
  }
  if (amount >= order.total) {
    await update("orders", order.id, {
      status: "refunded",
      updated_at: completedAt,
    });
    await update("payments", order.paymentId, {
      status: "refunded",
      provider_refund_id: providerId,
      refunded_at: completedAt,
      updated_at: completedAt,
    });
    await client.query(
      `UPDATE "notifications"
         SET "status" = 'suppressed', "suppressed_at" = $2,
             "last_error_code" = 'order_refunded', "updated_at" = $2
       WHERE "order_id" = $1 AND "kind" = 'event_reminder'
         AND "status" = 'queued'`,
      [order.id, completedAt]
    );
  }
  await outbox({
    key: `refund.succeeded:${key}`,
    topic: "refund.succeeded",
    payload: { refundId },
    aggregateType: "refund",
    aggregateId: refundId,
    deduplicationKey: `refund.succeeded:${refundId}`,
    createdAt: completedAt,
    completedAt: plus(completedAt, 1),
  });
  await notify({
    key: `refund.confirmation:${key}`,
    order,
    kind: "refund_confirmation",
    deduplicationKey: `refund.confirmation:${refundId}`,
    subject: `Refund confirmed for order ${order.publicNumber}`,
    text: `${money(amount)} for ${order.event.title} is on its way back to your original payment method.`,
    createdAt: plus(completedAt, 1),
  });
  return refundId;
}

async function scan({
  key,
  event,
  ticket,
  actor,
  deviceId,
  result,
  at: scannedAt,
  reason = null,
}) {
  const scanId = uuid(`scan:${key}`);
  await insert("scans", {
    id: scanId,
    organization_id: event.organization.id,
    event_id: event.id,
    ticket_id: ticket?.id ?? null,
    actor_user_id: actor.id,
    device_id: deviceId,
    result,
    reason,
    created_at: scannedAt,
  });
  if (result === "accepted") {
    ticket.status = "checked_in";
    await update("tickets", ticket.id, {
      status: "checked_in",
      checked_in_at: scannedAt,
    });
    await audit({
      key: `ticket.checked_in:${key}`,
      organizationId: event.organization.id,
      actor,
      action: "ticket.checked_in",
      targetType: "ticket",
      targetId: ticket.id,
      detail: {
        deviceId,
        eventId: event.id,
        publicNumber: ticket.publicNumber,
        scanId,
      },
      createdAt: scannedAt,
    });
  } else if (result === "reversed") {
    ticket.status = "active";
    await update("tickets", ticket.id, {
      status: "active",
      checked_in_at: null,
    });
    await audit({
      key: `ticket.checkin_reversed:${key}`,
      organizationId: event.organization.id,
      actor,
      action: "ticket.checkin_reversed",
      targetType: "ticket",
      targetId: ticket.id,
      detail: {
        deviceId,
        eventId: event.id,
        publicNumber: ticket.publicNumber,
        reason,
        scanId,
      },
      createdAt: scannedAt,
    });
  }
  return scanId;
}

// ---------------------------------------------------------------------------
// dataset

const orders = [];
const summary = {
  event: "database.seed_demo.completed",
  liveStripeIntents: 0,
};

async function randomOrders({
  event,
  prefix,
  count,
  from,
  to,
  lines,
  customers,
}) {
  const created = [];
  for (let index = 1; index <= count; index += 1) {
    const chosen = lines();
    if (!chosen) {
      break;
    }
    const order = await purchase({
      key: `${prefix}:${index}`,
      event,
      customer: pick(customers),
      lines: chosen,
      startedAt: randomBetween(from, to),
    });
    orders.push(order);
    created.push(order);
  }
  return created;
}

function gaLines(event, typeName, maxQuantity, remaining) {
  return () => {
    const left = remaining[typeName];
    if (left <= 0) {
      return null;
    }
    const quantity = Math.min(left, randomInt(1, maxQuantity));
    remaining[typeName] -= quantity;
    return [{ quantity, type: typeName }];
  };
}

function seatLines(event, typeName, maxSeats) {
  return () => {
    const seats = takeSeats(event, typeName, randomInt(1, maxSeats));
    return seats ? [{ seats, type: typeName }] : null;
  };
}

async function main() {
  const existing = await client.query(
    `SELECT 1 FROM "organizations" WHERE "slug" = $1`,
    [ORGANIZATION_SLUG]
  );
  if (existing.rowCount) {
    throw new Error(
      "demo data already present; run pnpm services:reset, pnpm db:migrate, then reseed"
    );
  }

  // stripe calls happen before the transaction so a failure leaves nothing behind
  const livePlans = [
    {
      amountMinor: 2 * (6500 + 650),
      key: "jazz:jordan",
      title: "Autumn Jazz Sessions",
    },
    {
      amountMinor: 2 * (2800 + 300),
      key: "indie:jordan",
      title: "Indie Night: The Wandering Lights",
    },
    {
      amountMinor: 2 * (3500 + 350),
      key: "symphony:jordan",
      title: "Symphony Under the Stars",
    },
  ];
  for (const plan of livePlans) {
    const publicNumber = orderNumber();
    const orderId = uuid(`order:${plan.key}`);
    const intent = liveStripe
      ? await createLiveIntent({ ...plan, orderId, publicNumber })
      : {
          clientSecret: `${providerIntentId()}_secret_${randomString(ALNUM, 24)}`,
          id: null,
        };
    if (liveStripe) {
      summary.liveStripeIntents += 1;
    }
    liveIntents.set(plan.key, { intent, publicNumber });
  }

  await client.query("BEGIN");
  await client.query(`SET LOCAL search_path TO "${schema}"`);

  // people
  const staff = {};
  for (const [key, email, role] of staffSpecs) {
    staff[key] = {
      ...(await createUser(key, email, { createdAt: at(-120, 13) })),
      role,
    };
  }
  const noor = await createUser("noor", "noor.haddad@harbourlight.test", {
    createdAt: at(-4, 15),
  });
  const theo = await createUser("theo", "theo.lindqvist@example.test", {
    createdAt: at(-90, 16),
  });
  const jordan = await createUser("jordan", "jordan.rivera@example.test", {
    createdAt: at(-80, 17),
  });
  const customers = [];
  for (const [key, email] of customerEmails) {
    customers.push(await createUser(key, email));
  }
  await createUser("casey", "casey.morgan@example.test", {
    createdAt: at(-1, 9),
    verified: false,
  });
  const byKey = (key) => users.get(key);

  // organizations
  const org = await createOrganization({
    key: "harbourlight",
    name: "Harbourlight Events",
    slug: ORGANIZATION_SLUG,
    owner: staff.maya,
    createdAt: at(-120, 14),
  });
  for (const [key, member] of Object.entries(staff)) {
    if (key === "maya") {
      continue;
    }
    await addMember({
      organization: org,
      user: member,
      role: key === "lucas" ? "viewer" : member.role,
      invitedBy: staff.maya,
      invitedAt: at(-119, 15, randomInt(0, 59)),
    });
  }
  const lucasMembership = uuid(`membership:harbourlight:lucas`);
  await update("organization_memberships", lucasMembership, {
    role: "finance",
    updated_at: at(-60, 16),
  });
  await audit({
    key: "member.role.changed:lucas",
    organizationId: org.id,
    actor: staff.daniel,
    action: "member.role.changed",
    targetType: "membership",
    targetId: lucasMembership,
    detail: {
      previousRole: "viewer",
      role: "finance",
      targetUserId: staff.lucas.id,
    },
    createdAt: at(-60, 16),
  });
  await addMember({
    organization: org,
    user: noor,
    role: "event_manager",
    invitedBy: staff.maya,
    invitedAt: at(-2, 15, 20),
    joined: false,
  });
  await update("organizations", org.id, {
    name: "Harbourlight Presents",
    version: 2,
    updated_at: at(-1, 10, 5),
  });
  org.name = "Harbourlight Presents";
  await audit({
    key: "organization.settings.updated:harbourlight",
    organizationId: org.id,
    actor: staff.maya,
    action: "organization.settings.updated",
    targetType: "organization",
    targetId: org.id,
    detail: {
      name: "Harbourlight Presents",
      previousName: "Harbourlight Events",
      version: 2,
    },
    createdAt: at(-1, 10, 5),
  });

  const riverside = await createOrganization({
    key: "riverside",
    name: "Riverside Comedy Collective",
    slug: "riverside-comedy",
    owner: theo,
    createdAt: at(-45, 18),
  });
  await addMember({
    organization: riverside,
    user: staff.maya,
    role: "viewer",
    invitedBy: theo,
    invitedAt: at(-30, 12),
  });

  // venues
  const theatre = await createVenue({
    key: "lakeshore",
    organization: org,
    name: "Lakeshore Theatre",
    description:
      "Restored 1920s proscenium house on Queens Quay. Orchestra and mezzanine, 92 seats.",
    actor: staff.priya,
    createdAt: at(-118, 14),
    sections: [
      {
        name: "Orchestra",
        kind: "assigned",
        rows: seatRows({
          labels: ["A", "B", "C", "D", "E", "F"],
          seatsPerRow: 10,
          gapAfter: 5,
          access: {
            "A-9": "companion",
            "A-10": "accessible",
            "F-1": "accessible",
            "F-2": "companion",
          },
        }),
      },
      {
        name: "Mezzanine",
        kind: "assigned",
        rows: seatRows({
          labels: ["A", "B", "C", "D"],
          seatsPerRow: 8,
          gapAfter: 4,
          access: { "D-1": "accessible", "D-2": "companion" },
        }),
      },
    ],
  });
  const cellar = await createVenue({
    key: "cellar",
    organization: org,
    name: "The Cellar",
    description:
      "Standing-room basement club under a King Street West bakery. Two bars, one stage.",
    actor: staff.priya,
    createdAt: at(-117, 11),
    sections: [
      { name: "Main Floor", kind: "general_admission", capacity: 120 },
      { name: "Balcony Bar", kind: "general_admission", capacity: 30 },
    ],
  });
  const pavilion = await createVenue({
    key: "pavilion",
    organization: org,
    name: "Harbour Pavilion",
    description:
      "Open-air waterfront stage with a covered reserved terrace and a lawn for general admission.",
    actor: staff.maya,
    createdAt: at(-116, 15),
    sections: [
      {
        name: "Reserved Terrace",
        kind: "assigned",
        rows: seatRows({
          labels: ["A", "B", "C"],
          seatsPerRow: 12,
          access: {
            "A-1": "accessible",
            "A-2": "companion",
            "C-11": "companion",
            "C-12": "accessible",
          },
        }),
      },
      { name: "Lawn", kind: "general_admission", capacity: 400 },
    ],
  });
  const loft = await createVenue({
    key: "riverside-loft",
    organization: riverside,
    name: "Riverside Loft",
    description:
      "Third-floor walk-up with folding chairs and a very good sound system.",
    actor: theo,
    createdAt: at(-44, 19),
    sections: [{ name: "Loft Floor", kind: "general_admission", capacity: 80 }],
  });

  // events
  const jazz = await createEvent({
    key: "jazz",
    organization: org,
    venue: theatre,
    actor: staff.priya,
    title: "Autumn Jazz Sessions",
    description:
      "An evening with the Nadia Belrose Quartet and special guest trumpeter Elias Kwan. Doors open one hour before the first set; the bar stays open through the intermission.",
    status: "published",
    startsAt: at(22, 0, 0),
    endsAt: at(22, 3, 0),
    salesStartAt: at(-40, 14),
    publishedAt: at(-40, 13, 30),
    refundPolicy: "Full refund, including fees, up to 24 hours before doors.",
    customerRefundsEnabled: true,
    ticketTypes: [
      {
        name: "Orchestra",
        kind: "assigned",
        sectionName: "Orchestra",
        priceMinor: 6500,
        feeMinor: 650,
      },
      {
        name: "Mezzanine",
        kind: "assigned",
        sectionName: "Mezzanine",
        priceMinor: 4500,
        feeMinor: 450,
      },
    ],
    blockedSeats: [
      "Orchestra|A|5",
      "Orchestra|A|6",
      "Mezzanine|A|4",
      "Mezzanine|A|5",
    ],
  });
  const indie = await createEvent({
    key: "indie",
    organization: org,
    venue: cellar,
    actor: staff.priya,
    title: "Indie Night: The Wandering Lights",
    description:
      "Album release show for The Wandering Lights with openers Paper Harbour. 19+ event, standing room only, coat check available.",
    status: "published",
    startsAt: at(8, 1, 0),
    endsAt: at(8, 4, 0),
    salesStartAt: at(-30, 15),
    publishedAt: at(-30, 14, 45),
    refundPolicy: "All sales are final.",
    ticketTypes: [
      {
        name: "Main Floor",
        kind: "general_admission",
        sectionName: "Main Floor",
        priceMinor: 2800,
        feeMinor: 300,
        capacity: 120,
      },
      {
        name: "Balcony Bar",
        kind: "general_admission",
        sectionName: "Balcony Bar",
        priceMinor: 4200,
        feeMinor: 400,
        capacity: 30,
      },
    ],
  });
  const symphony = await createEvent({
    key: "symphony",
    organization: org,
    venue: pavilion,
    actor: staff.priya,
    title: "Symphony Under the Stars",
    description:
      "The Harbourfront Chamber Orchestra performs Holst's The Planets on the waterfront. Reserved terrace seating or bring a blanket for the lawn.",
    status: "published",
    startsAt: at(50, 23, 30),
    endsAt: at(51, 2, 30),
    salesStartAt: at(-35, 14),
    publishedAt: at(-35, 13, 15),
    refundPolicy:
      "Refunds available until 48 hours before the concert. Rain or shine.",
    customerRefundsEnabled: true,
    customerRefundCutoffMinutes: 2880,
    ticketTypes: [
      {
        name: "Reserved Terrace",
        kind: "assigned",
        sectionName: "Reserved Terrace",
        priceMinor: 8500,
        feeMinor: 850,
      },
      {
        name: "Lawn",
        kind: "general_admission",
        sectionName: "Lawn",
        priceMinor: 3500,
        feeMinor: 350,
        capacity: 400,
      },
    ],
  });
  const fest = await createEvent({
    key: "fest",
    organization: org,
    venue: pavilion,
    actor: staff.maya,
    title: "Harbourlight Summer Fest 2026",
    description:
      "Eight bands, two stages, and the food trucks return. Our biggest night of the year on the waterfront.",
    status: "published",
    startsAt: at(-20, 21, 0),
    endsAt: at(-19, 3, 0),
    salesStartAt: at(-75, 14),
    publishedAt: at(-75, 13, 0),
    holdDurationSeconds: 900,
    refundPolicy: "Refund requests accepted until 24 hours before gates open.",
    customerRefundsEnabled: true,
    ticketTypes: [
      {
        name: "Reserved Terrace",
        kind: "assigned",
        sectionName: "Reserved Terrace",
        priceMinor: 9500,
        feeMinor: 950,
      },
      {
        name: "Lawn",
        kind: "general_admission",
        sectionName: "Lawn",
        priceMinor: 4800,
        feeMinor: 480,
        capacity: 400,
      },
    ],
  });
  const gala = await createEvent({
    key: "gala",
    organization: org,
    venue: theatre,
    actor: staff.maya,
    title: "Winter Gala",
    description:
      "Black-tie fundraiser with dinner service in the lobby and a live auction after the performance. Sales paused while the seating plan is revised.",
    status: "sales_paused",
    startsAt: at(85, 0, 0),
    endsAt: at(85, 4, 0),
    salesStartAt: at(-25, 14),
    publishedAt: at(-25, 13, 40),
    updatedAt: at(-3, 11),
    refundPolicy: "Full refund up to 7 days before the gala.",
    customerRefundsEnabled: true,
    customerRefundCutoffMinutes: 10080,
    ticketTypes: [
      {
        name: "Orchestra",
        kind: "assigned",
        sectionName: "Orchestra",
        priceMinor: 12000,
        feeMinor: 1200,
      },
      {
        name: "Mezzanine",
        kind: "assigned",
        sectionName: "Mezzanine",
        priceMinor: 8000,
        feeMinor: 800,
      },
    ],
  });
  const comedy = await createEvent({
    key: "comedy",
    organization: org,
    venue: cellar,
    actor: staff.priya,
    title: "Comedy Night: Open Mic Finals",
    description:
      "Twelve finalists from the autumn open mic series compete for a paid headline slot. Hosted by Dee Marchetti.",
    status: "draft",
    createdAt: at(-3, 16, 10),
    startsAt: at(71, 1, 30),
    endsAt: at(71, 4, 0),
    salesStartAt: at(1, 14),
    refundPolicy: "Refunds up to 24 hours before the show.",
    ticketTypes: [
      {
        name: "General Admission",
        kind: "general_admission",
        sectionName: "Main Floor",
        priceMinor: 1500,
        feeMinor: 150,
        capacity: 120,
      },
    ],
  });
  const folk = await createEvent({
    key: "folk",
    organization: org,
    venue: pavilion,
    actor: staff.priya,
    title: "Riverside Folk Evening",
    description:
      "Acoustic sets from three Ontario songwriters. Postponed after the headliner's tour dates moved; new date to be announced.",
    status: "postponed",
    startsAt: at(-13, 23, 0),
    endsAt: at(-12, 2, 0),
    salesStartAt: at(-60, 14),
    publishedAt: at(-60, 13, 20),
    updatedAt: at(-16, 9),
    ticketTypes: [
      {
        name: "Reserved Terrace",
        kind: "assigned",
        sectionName: "Reserved Terrace",
        priceMinor: 4200,
        feeMinor: 420,
      },
    ],
  });
  const block = await createEvent({
    key: "block",
    organization: org,
    venue: pavilion,
    actor: staff.maya,
    title: "Late Summer Block Party",
    description:
      "Free-flowing afternoon of DJs, food, and lawn games. Cancelled ahead of a severe weather warning.",
    status: "cancelled",
    startsAt: at(-5, 20, 0),
    endsAt: at(-5, 23, 30),
    salesStartAt: at(-45, 14),
    publishedAt: at(-45, 13, 0),
    updatedAt: at(-7, 8, 45),
    reminders: "suppressed",
    cancelledAt: at(-7, 8, 45),
    ticketTypes: [
      {
        name: "Lawn",
        kind: "general_admission",
        sectionName: "Lawn",
        priceMinor: 1500,
        feeMinor: 150,
        capacity: 400,
      },
    ],
  });
  const showcase = await createEvent({
    key: "showcase",
    organization: org,
    venue: theatre,
    actor: staff.priya,
    title: "Spring Showcase 2026",
    description:
      "Season preview featuring excerpts from every production on the spring calendar.",
    status: "completed",
    startsAt: at(-130, 0, 0),
    endsAt: at(-130, 3, 0),
    salesStartAt: at(-190, 14),
    publishedAt: at(-190, 13, 0),
    updatedAt: at(-128, 9),
    ticketTypes: [
      {
        name: "Orchestra",
        kind: "assigned",
        sectionName: "Orchestra",
        priceMinor: 3000,
        feeMinor: 300,
      },
    ],
  });
  const launch = await createEvent({
    key: "launch",
    organization: org,
    venue: theatre,
    actor: staff.maya,
    title: "Harbourlight Launch Party",
    description: "The night we opened the doors.",
    status: "archived",
    startsAt: at(-200, 1, 0),
    endsAt: at(-200, 4, 0),
    salesStartAt: at(-240, 14),
    publishedAt: at(-240, 13, 0),
    updatedAt: at(-150, 9),
    ticketTypes: [
      {
        name: "Orchestra",
        kind: "assigned",
        sectionName: "Orchestra",
        priceMinor: 2500,
        feeMinor: 250,
      },
    ],
  });
  await createEvent({
    key: "improv",
    organization: riverside,
    venue: loft,
    actor: theo,
    title: "Tuesday Night Improv",
    description:
      "Long-form improv from the Riverside house team. Bring a suggestion.",
    status: "draft",
    createdAt: at(-20, 19),
    startsAt: at(35, 0, 0),
    endsAt: at(35, 2, 0),
    salesStartAt: at(2, 14),
    ticketTypes: [
      {
        name: "Loft Floor",
        kind: "general_admission",
        sectionName: "Loft Floor",
        priceMinor: 1200,
        feeMinor: 120,
        capacity: 80,
      },
    ],
  });

  const salesEndFor = (event) =>
    new Date(
      Math.min(
        plus(now, -3600).getTime(),
        plus(event.startsAt, -1800).getTime()
      )
    );

  // autumn jazz: live sales, mixed seat availability, one abandoned checkout
  const jordanJazz = await purchase({
    key: "jazz:jordan",
    event: jazz,
    customer: jordan,
    lines: [
      {
        seats: takeSpecificSeats(jazz, "Orchestra", ["D5", "D6"]),
        type: "Orchestra",
      },
    ],
    startedAt: at(-6, 19, 12),
    live: true,
  });
  orders.push(jordanJazz);
  await randomOrders({
    event: jazz,
    prefix: "jazz:orchestra",
    count: 13,
    from: jazz.salesStartAt,
    to: salesEndFor(jazz),
    lines: seatLines(jazz, "Orchestra", 3),
    customers,
  });
  await randomOrders({
    event: jazz,
    prefix: "jazz:mezzanine",
    count: 8,
    from: jazz.salesStartAt,
    to: salesEndFor(jazz),
    lines: seatLines(jazz, "Mezzanine", 2),
    customers,
  });
  await purchase({
    key: "jazz:abandoned",
    event: jazz,
    customer: byKey("farah"),
    lines: [{ seats: takeSeats(jazz, "Mezzanine", 2), type: "Mezzanine" }],
    startedAt: at(-3, 22, 5),
    outcome: "abandoned",
  });
  for (let index = 1; index <= 6; index += 1) {
    const seats = takeSeats(jazz, "Orchestra", randomInt(1, 2));
    if (!seats) {
      break;
    }
    await abandonedHold({
      key: `jazz:drop:${index}`,
      event: jazz,
      customer: pick(customers),
      lines: [{ seats, type: "Orchestra" }],
      startedAt: randomBetween(jazz.salesStartAt, salesEndFor(jazz)),
    });
  }
  await activeHold({
    key: "jazz:live-hold:amara",
    event: jazz,
    customer: byKey("amara"),
    lines: [{ seats: takeSeats(jazz, "Orchestra", 2), type: "Orchestra" }],
    remainingSeconds: 9 * 60,
  });
  await activeHold({
    key: "jazz:live-hold:ben",
    event: jazz,
    customer: byKey("ben"),
    lines: [{ seats: takeSeats(jazz, "Mezzanine", 1), type: "Mezzanine" }],
    remainingSeconds: 6 * 60,
  });

  // indie night: nearly sold out floor, sold-out balcony, one dead-letter email
  const indieRemaining = { "Balcony Bar": 30, "Main Floor": 108 };
  const jordanIndie = await purchase({
    key: "indie:jordan",
    event: indie,
    customer: jordan,
    lines: [{ quantity: 2, type: "Main Floor" }],
    startedAt: at(-12, 20, 41),
    live: true,
  });
  orders.push(jordanIndie);
  const quinnIndie = await purchase({
    key: "indie:quinn",
    event: indie,
    customer: byKey("quinn"),
    lines: [{ quantity: 2, type: "Main Floor" }],
    startedAt: at(-2, 12, 18),
    confirmationDelivery: "dead_letter",
  });
  orders.push(quinnIndie);
  indieRemaining["Main Floor"] -= 2;
  await randomOrders({
    event: indie,
    prefix: "indie:floor",
    count: 60,
    from: indie.salesStartAt,
    to: salesEndFor(indie),
    lines: gaLines(indie, "Main Floor", 4, indieRemaining),
    customers,
  });
  await randomOrders({
    event: indie,
    prefix: "indie:balcony",
    count: 20,
    from: indie.salesStartAt,
    to: salesEndFor(indie),
    lines: gaLines(indie, "Balcony Bar", 3, indieRemaining),
    customers,
  });
  for (let index = 1; index <= 5; index += 1) {
    await abandonedHold({
      key: `indie:drop:${index}`,
      event: indie,
      customer: pick(customers),
      lines: [{ quantity: randomInt(1, 3), type: "Main Floor" }],
      startedAt: randomBetween(indie.salesStartAt, salesEndFor(indie)),
    });
  }
  await activeHold({
    key: "indie:live-hold:chloe",
    event: indie,
    customer: byKey("chloe"),
    lines: [{ quantity: 2, type: "Main Floor" }],
    remainingSeconds: 8 * 60,
  });

  // symphony: early sales
  const jordanSymphony = await purchase({
    key: "symphony:jordan",
    event: symphony,
    customer: jordan,
    lines: [{ quantity: 2, type: "Lawn" }],
    startedAt: at(-9, 13, 2),
    live: true,
  });
  orders.push(jordanSymphony);
  await randomOrders({
    event: symphony,
    prefix: "symphony:terrace",
    count: 4,
    from: symphony.salesStartAt,
    to: salesEndFor(symphony),
    lines: seatLines(symphony, "Reserved Terrace", 2),
    customers,
  });
  await randomOrders({
    event: symphony,
    prefix: "symphony:lawn",
    count: 18,
    from: symphony.salesStartAt,
    to: salesEndFor(symphony),
    lines: gaLines(symphony, "Lawn", 4, { Lawn: 46 }),
    customers,
  });

  // summer fest: past event with a full night of scans and refunds
  const festEnd = plus(fest.startsAt, -1800);
  const jordanFest = await purchase({
    key: "fest:jordan",
    event: fest,
    customer: jordan,
    lines: [{ quantity: 2, type: "Lawn" }],
    startedAt: at(-41, 18, 33),
  });
  orders.push(jordanFest);
  const hannahFest = await purchase({
    key: "fest:hannah",
    event: fest,
    customer: byKey("hannah"),
    lines: [{ quantity: 2, type: "Lawn" }],
    startedAt: at(-38, 12, 9),
  });
  orders.push(hannahFest);
  const marcoFest = await purchase({
    key: "fest:marco",
    event: fest,
    customer: byKey("marco"),
    lines: [{ quantity: 1, type: "Lawn" }],
    startedAt: at(-33, 21, 47),
  });
  orders.push(marcoFest);
  const zaneFest = await purchase({
    key: "fest:zane",
    event: fest,
    customer: byKey("zane"),
    lines: [{ quantity: 1, type: "Lawn" }],
    startedAt: at(-29, 16, 20),
  });
  orders.push(zaneFest);
  const festTerrace = await randomOrders({
    event: fest,
    prefix: "fest:terrace",
    count: 14,
    from: fest.salesStartAt,
    to: festEnd,
    lines: seatLines(fest, "Reserved Terrace", 3),
    customers,
  });
  const festLawn = await randomOrders({
    event: fest,
    prefix: "fest:lawn",
    count: 58,
    from: fest.salesStartAt,
    to: festEnd,
    lines: gaLines(fest, "Lawn", 4, { Lawn: 134 }),
    customers,
  });

  await refund({
    key: "fest:hannah",
    order: hannahFest,
    units: [
      { item: hannahFest.items[0], tickets: hannahFest.items[0].tickets },
    ],
    initiator: "customer",
    actor: byKey("hannah"),
    requestedAt: at(-25, 15, 30),
  });
  await refund({
    key: "fest:marco",
    order: marcoFest,
    units: [{ item: marcoFest.items[0], tickets: marcoFest.items[0].tickets }],
    initiator: "organizer",
    actor: staff.daniel,
    reason:
      "Guest reported a duplicate charge; card issuer already reversed it.",
    requestedAt: at(-21, 14, 12),
    outcome: "failed",
    failureCode: "charge_already_refunded",
  });
  await refund({
    key: "fest:jordan",
    order: jordanFest,
    units: [
      { item: jordanFest.items[0], tickets: [jordanFest.items[0].tickets[1]] },
    ],
    initiator: "organizer",
    actor: staff.daniel,
    reason:
      "Plus-one cancelled the morning of the show; goodwill refund, no inventory return.",
    requestedAt: at(-20, 17, 5),
  });
  zaneFest.items[0].tickets[0].status = "void";
  await update("tickets", zaneFest.items[0].tickets[0].id, { status: "void" });

  const gate = [
    "lawn-gate-android-01",
    "lawn-gate-android-02",
    "terrace-door-ipad-01",
  ];
  const doors = plus(fest.startsAt, -1800);
  const festTickets = [];
  for (const order of [...festTerrace, ...festLawn]) {
    for (const item of order.items) {
      festTickets.push(...item.tickets);
    }
  }
  const scanOrder = festTickets.slice();
  scanOrder.sort(() => random() - 0.5);
  const admitted = [];
  let scanIndex = 0;
  for (const ticket of scanOrder) {
    if (random() < 0.12) {
      continue;
    }
    scanIndex += 1;
    const scannedAt = plus(doors, randomInt(0, 3 * 3600));
    await scan({
      key: `fest:accepted:${scanIndex}`,
      event: fest,
      ticket,
      actor: random() < 0.8 ? staff.sam : staff.daniel,
      deviceId: ticket.seat ? gate[2] : pick(gate.slice(0, 2)),
      result: "accepted",
      at: scannedAt,
    });
    admitted.push({ at: scannedAt, ticket });
  }
  await scan({
    key: "fest:accepted:jordan",
    event: fest,
    ticket: jordanFest.items[0].tickets[0],
    actor: staff.sam,
    deviceId: gate[0],
    result: "accepted",
    at: plus(doors, 2400),
  });
  await scan({
    key: "fest:accepted:marco",
    event: fest,
    ticket: marcoFest.items[0].tickets[0],
    actor: staff.sam,
    deviceId: gate[1],
    result: "accepted",
    at: plus(doors, 3100),
  });
  for (let index = 1; index <= 6; index += 1) {
    const entry = admitted[index * 7];
    await scan({
      key: `fest:duplicate:${index}`,
      event: fest,
      ticket: entry.ticket,
      actor: staff.sam,
      deviceId: gate[1],
      result: "duplicate",
      at: plus(entry.at, randomInt(120, 2400)),
    });
  }
  const reversedEntry = admitted[3];
  await scan({
    key: "fest:reversed:1",
    event: fest,
    ticket: reversedEntry.ticket,
    actor: staff.daniel,
    deviceId: gate[0],
    result: "reversed",
    at: plus(reversedEntry.at, 300),
    reason: "Scanned the wrong guest's phone in a group of four.",
  });
  await scan({
    key: "fest:reaccepted:1",
    event: fest,
    ticket: reversedEntry.ticket,
    actor: staff.sam,
    deviceId: gate[0],
    result: "accepted",
    at: plus(reversedEntry.at, 900),
  });
  const leftEntry = admitted[11];
  await scan({
    key: "fest:reversed:2",
    event: fest,
    ticket: leftEntry.ticket,
    actor: staff.daniel,
    deviceId: gate[1],
    result: "reversed",
    at: plus(leftEntry.at, 420),
    reason: "Guest left to move a car and will re-enter through the main gate.",
  });
  await scan({
    key: "fest:refunded:hannah",
    event: fest,
    ticket: hannahFest.items[0].tickets[0],
    actor: staff.sam,
    deviceId: gate[0],
    result: "refunded",
    at: plus(doors, 1500),
  });
  await scan({
    key: "fest:void:zane",
    event: fest,
    ticket: zaneFest.items[0].tickets[0],
    actor: staff.sam,
    deviceId: gate[1],
    result: "void",
    at: plus(doors, 4100),
  });
  for (let index = 1; index <= 3; index += 1) {
    await scan({
      key: `fest:invalid:${index}`,
      event: fest,
      ticket: null,
      actor: staff.sam,
      deviceId: pick(gate),
      result: "invalid",
      at: plus(doors, randomInt(600, 9000)),
    });
  }

  // winter gala: paused sales, one refunded seat
  const jordanGala = await purchase({
    key: "gala:jordan",
    event: gala,
    customer: jordan,
    lines: [
      {
        seats: takeSpecificSeats(gala, "Mezzanine", ["B3"]),
        type: "Mezzanine",
      },
    ],
    startedAt: at(-19, 11, 26),
  });
  orders.push(jordanGala);
  await randomOrders({
    event: gala,
    prefix: "gala:orchestra",
    count: 4,
    from: gala.salesStartAt,
    to: at(-3, 10),
    lines: seatLines(gala, "Orchestra", 2),
    customers,
  });
  await randomOrders({
    event: gala,
    prefix: "gala:mezzanine",
    count: 2,
    from: gala.salesStartAt,
    to: at(-3, 10),
    lines: seatLines(gala, "Mezzanine", 2),
    customers,
  });
  await refund({
    key: "gala:jordan",
    order: jordanGala,
    units: [
      { item: jordanGala.items[0], tickets: jordanGala.items[0].tickets },
    ],
    initiator: "customer",
    actor: jordan,
    requestedAt: at(-4, 9, 48),
  });

  // folk evening: sold before the postponement
  const folkOrders = await randomOrders({
    event: folk,
    prefix: "folk:terrace",
    count: 3,
    from: folk.salesStartAt,
    to: at(-17, 12),
    lines: seatLines(folk, "Reserved Terrace", 2),
    customers,
  });

  // block party: cancelled with notices to every paid order
  const blockOrders = await randomOrders({
    event: block,
    prefix: "block:lawn",
    count: 4,
    from: block.salesStartAt,
    to: at(-8, 12),
    lines: gaLines(block, "Lawn", 3, { Lawn: 9 }),
    customers,
  });
  await update("events", block.id, { version: 6 });
  await audit({
    key: "event.cancelled:block",
    organizationId: org.id,
    actor: staff.maya,
    action: "event.cancelled",
    targetType: "event",
    targetId: block.id,
    detail: {
      reason:
        "Environment Canada severe thunderstorm warning for the waterfront.",
      version: 6,
    },
    createdAt: block.cancelledAt,
  });
  for (const order of blockOrders) {
    await notify({
      key: `event.cancelled:${order.key}`,
      order,
      kind: "event_cancelled",
      deduplicationKey: `event.cancelled:${block.id}:${order.id}`,
      subject: `${block.title} was cancelled`,
      text: `${block.title} will not go ahead. Order ${order.publicNumber} will be refunded in full within five business days.`,
      createdAt: block.cancelledAt,
    });
  }

  // spring showcase: completed, one late scan
  const showcaseOrders = await randomOrders({
    event: showcase,
    prefix: "showcase:orchestra",
    count: 5,
    from: showcase.salesStartAt,
    to: plus(showcase.startsAt, -7200),
    lines: seatLines(showcase, "Orchestra", 2),
    customers,
  });
  let showcaseScan = 0;
  for (const order of showcaseOrders) {
    for (const ticket of order.items.flatMap((item) => item.tickets)) {
      showcaseScan += 1;
      await scan({
        key: `showcase:accepted:${showcaseScan}`,
        event: showcase,
        ticket,
        actor: staff.sam,
        deviceId: "lobby-door-ipad-01",
        result: showcaseScan === 1 ? "expired" : "accepted",
        at:
          showcaseScan === 1
            ? plus(showcase.endsAt, 5400)
            : plus(showcase.startsAt, -randomInt(300, 3000)),
      });
    }
  }
  await scan({
    key: "fest:wrong-event:folk",
    event: fest,
    ticket: folkOrders[0].items[0].tickets[0],
    actor: staff.sam,
    deviceId: gate[2],
    result: "wrong_event",
    at: plus(doors, 2200),
  });

  // launch party: archived history
  await randomOrders({
    event: launch,
    prefix: "launch:orchestra",
    count: 2,
    from: launch.salesStartAt,
    to: plus(launch.startsAt, -7200),
    lines: seatLines(launch, "Orchestra", 2),
    customers,
  });

  await client.query("COMMIT");

  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM "users")::int AS users,
      (SELECT count(*) FROM "events")::int AS events,
      (SELECT count(*) FROM "orders" WHERE "status" = 'paid')::int AS paid_orders,
      (SELECT count(*) FROM "tickets")::int AS tickets,
      (SELECT count(*) FROM "scans")::int AS scans,
      (SELECT count(*) FROM "refunds")::int AS refunds,
      (SELECT count(*) FROM "outbox_events")::int AS outbox_events
  `);
  process.stdout.write(
    `${JSON.stringify({
      ...summary,
      ...counts.rows[0],
      accounts: {
        customer: jordan.email,
        organizationId: org.id,
        owner: staff.maya.email,
        password: "demo-password-2026",
        scanner: staff.sam.email,
      },
      eventIds: {
        jazz: jazz.id,
        indie: indie.id,
        symphony: symphony.id,
        comedy: comedy.id,
        fest: fest.id,
      },
      paymentProvider,
    })}\n`
  );
}

try {
  await client.connect();
  await main();
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
