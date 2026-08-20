// purchase load needs seeded data, fake payments, and a worker
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:4000";
const eventId = __ENV.EVENT_ID || "dddddddd-dddd-4ddd-8ddd-000000000100";
const gaTicketTypeId =
  __ENV.GA_TICKET_TYPE_ID || "dddddddd-dddd-4ddd-8ddd-000000000202";
const buyerCount = Number(__ENV.BUYERS || 250);
// local-only cred matching seed scripts
const buyerPassword = __ENV.BUYER_PASSWORD || "owner-password-dev";
const targetPurchases = Number(__ENV.TARGET_PURCHASES || 1000);
const orderTimeoutSeconds = Number(__ENV.ORDER_TIMEOUT_S || 120);

const purchases = new Counter("purchases_completed");
const seatRaceWins = new Counter("seat_race_wins");
const seatRaceConflicts = new Counter("seat_race_conflicts");
const gaCapacityConflicts = new Counter("ga_capacity_conflicts");
const holdReplays = new Counter("hold_replays");
const abandonedHolds = new Counter("abandoned_holds");
const checkoutReplays = new Counter("checkout_replays");
const paymentDeclines = new Counter("payment_declines_simulated");
const purchaseTimeouts = new Counter("purchase_timeouts");
const invariantFailures = new Rate("invariant_failures");
const finalizeWait = new Trend("finalize_wait_ms", true);

// 409 = expected contention, not failure
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

export const options = {
  // keep browser cookies across iterations; login once
  noCookiesReset: true,
  scenarios: {
    purchases: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 50),
      iterations: Number(__ENV.ITERATIONS || 1100),
      maxDuration: __ENV.MAX_DURATION || "30m",
      gracefulStop: "60s",
    },
  },
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:hold-ga}": ["p(95)<500"],
    "http_req_duration{name:hold-assigned}": ["p(95)<500"],
    "http_req_duration{name:checkout}": ["p(95)<500"],
    invariant_failures: ["rate==0"],
    purchases_completed: [`count>=${targetPurchases}`],
  },
};

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let csrfToken = null;

function jsonHeaders(extra) {
  return Object.assign(
    {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    extra || {}
  );
}

function ensureSession() {
  if (csrfToken !== null) {
    return true;
  }
  const index = ((__VU - 1) % buyerCount) + 1;
  const email = `load-buyer-${String(index).padStart(4, "0")}@example.test`;
  const response = http.post(
    `${baseUrl}/auth/login`,
    JSON.stringify({ email, password: buyerPassword }),
    { headers: { "Content-Type": "application/json" }, tags: { name: "login" } }
  );
  const ok = check(response, {
    "login succeeded": (r) => r.status === 200,
  });
  if (!ok) {
    return false;
  }
  csrfToken = response.cookies["et_csrf"][0].value;
  return true;
}

function pollOrderUntilPaid(orderId) {
  const started = Date.now();
  while ((Date.now() - started) / 1000 < orderTimeoutSeconds) {
    const response = http.get(`${baseUrl}/orders/${orderId}`, {
      tags: { name: "order-poll" },
    });
    if (response.status === 200) {
      const order = response.json();
      if (order.status === "paid") {
        return order;
      }
      if (order.status !== "pending_payment") {
        // payment_conflict unexpected here; inventory was reserved
        invariantFailures.add(true);
        return null;
      }
    }
    sleep(0.4);
  }
  purchaseTimeouts.add(1);
  return null;
}

// database checks validate issued tickets later
function purchaseHold(holdId, expectedTickets, exerciseReplays) {
  const checkoutResponse = http.post(
    `${baseUrl}/checkout`,
    JSON.stringify({ holdId }),
    { headers: jsonHeaders(), tags: { name: "checkout" } }
  );
  if (
    !check(checkoutResponse, {
      "checkout created": (r) => r.status === 201,
    })
  ) {
    console.error(
      `checkout failed: ${checkoutResponse.status} ${String(checkoutResponse.body).slice(0, 120)}`
    );
    return false;
  }
  const orderId = checkoutResponse.json().orderId;

  if (exerciseReplays) {
    const replay = http.post(
      `${baseUrl}/checkout`,
      JSON.stringify({ holdId }),
      {
        headers: jsonHeaders(),
        tags: { name: "checkout-replay" },
      }
    );
    checkoutReplays.add(1);
    const replayedSameOrder =
      replay.status === 201 && replay.json().orderId === orderId;
    check(replay, {
      "checkout replay returned the same order": () => replayedSameOrder,
    });
    invariantFailures.add(!replayedSameOrder);
  }

  if (exerciseReplays) {
    const decline = http.post(
      `${baseUrl}/payments/simulate`,
      JSON.stringify({ orderId, outcome: "fail" }),
      { headers: jsonHeaders(), tags: { name: "payment-simulate" } }
    );
    check(decline, { "decline accepted": (r) => r.status === 202 });
    paymentDeclines.add(1);
  }

  const simulate = http.post(
    `${baseUrl}/payments/simulate`,
    JSON.stringify({ orderId, outcome: "succeed" }),
    { headers: jsonHeaders(), tags: { name: "payment-simulate" } }
  );
  if (
    !check(simulate, {
      "payment simulation accepted": (r) => r.status === 202,
    })
  ) {
    return false;
  }

  const simulatedAt = Date.now();
  const order = pollOrderUntilPaid(orderId);
  if (order === null) {
    return false;
  }
  finalizeWait.add(Date.now() - simulatedAt);

  const issued =
    order.ticketCount === expectedTickets &&
    order.paidAt !== null &&
    order.payment.status === "succeeded";
  check(order, { "tickets issued for paid order": () => issued });
  invariantFailures.add(!issued);
  if (issued) {
    purchases.add(1);
  }
  return issued;
}

export default function () {
  if (!ensureSession()) {
    sleep(1);
    return;
  }

  const availability = http.get(
    `${baseUrl}/discovery/events/${eventId}/availability`,
    { tags: { name: "availability" } }
  );
  if (
    !check(availability, {
      "availability loaded": (r) => r.status === 200,
    })
  ) {
    sleep(1);
    return;
  }
  const body = availability.json();

  // every 5th iter races one seat for deliberate contention (409)
  if (__ITER % 5 === 0) {
    const seats = [];
    for (const section of body.sections) {
      for (const seat of section.seats) {
        seats.push(seat);
      }
    }
    const available = seats.filter((seat) => seat.status === "available");
    const pool = available.length > 0 ? available : seats;
    if (pool.length > 0) {
      const seat = pool[Math.floor(Math.random() * pool.length)];
      const holdResponse = http.post(
        `${baseUrl}/holds/assigned`,
        JSON.stringify({ eventId, seatIds: [seat.id] }),
        {
          headers: jsonHeaders({ "Idempotency-Key": uuidv4() }),
          tags: { name: "hold-assigned" },
        }
      );
      if (holdResponse.status === 201) {
        seatRaceWins.add(1);
        purchaseHold(holdResponse.json().holdId, 1, false);
      } else if (
        holdResponse.status === 409 &&
        holdResponse.json().code === "seats_unavailable"
      ) {
        seatRaceConflicts.add(1);
      } else {
        check(holdResponse, { "assigned hold outcome expected": () => false });
      }
    }
  }

  const quantity = 1 + (__ITER % 2);
  const idempotencyKey = uuidv4();
  const holdBody = JSON.stringify({
    eventId,
    items: [{ ticketTypeId: gaTicketTypeId, quantity }],
  });
  const holdResponse = http.post(
    `${baseUrl}/holds/general-admission`,
    holdBody,
    {
      headers: jsonHeaders({ "Idempotency-Key": idempotencyKey }),
      tags: { name: "hold-ga" },
    }
  );
  if (holdResponse.status === 409) {
    if (holdResponse.json().code === "capacity_unavailable") {
      gaCapacityConflicts.add(1);
      return;
    }
  }
  if (
    !check(holdResponse, {
      "general-admission hold created": (r) => r.status === 201,
    })
  ) {
    console.error(
      `hold failed: ${holdResponse.status} ${String(holdResponse.body).slice(0, 120)}`
    );
    sleep(0.5);
    return;
  }
  const holdId = holdResponse.json().holdId;

  // periodic retries exercise idempotency and declines
  const exerciseReplays = __ITER % 10 === 0;
  if (exerciseReplays) {
    const replay = http.post(`${baseUrl}/holds/general-admission`, holdBody, {
      headers: jsonHeaders({ "Idempotency-Key": idempotencyKey }),
      tags: { name: "hold-ga-replay" },
    });
    holdReplays.add(1);
    const replayedSameHold =
      replay.status === 201 && replay.json().holdId === holdId;
    check(replay, {
      "hold replay returned the same hold": () => replayedSameHold,
    });
    invariantFailures.add(!replayedSameHold);
  }

  purchaseHold(holdId, quantity, exerciseReplays);

  // abandoned holds exercise expiry release
  if (__ITER % 20 === 7) {
    const abandoned = http.post(
      `${baseUrl}/holds/general-admission`,
      JSON.stringify({
        eventId,
        items: [{ ticketTypeId: gaTicketTypeId, quantity: 1 }],
      }),
      {
        headers: jsonHeaders({ "Idempotency-Key": uuidv4() }),
        tags: { name: "hold-ga-abandoned" },
      }
    );
    if (
      check(abandoned, { "abandoned hold created": (r) => r.status === 201 })
    ) {
      abandonedHolds.add(1);
    }
  }
}
