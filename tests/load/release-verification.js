import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:4000";
const eventId = __ENV.EVENT_ID || "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const invariantFailures = new Rate("invariant_failures");

export const options = {
  scenarios: {
    catalog: {
      executor: "constant-vus",
      duration: __ENV.DURATION || "30s",
      gracefulStop: "5s",
      vus: Number(__ENV.VUS || 2),
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    invariant_failures: ["rate==0"],
  },
};

export default function () {
  const responses = http.batch([
    ["GET", `${baseUrl}/health/live`],
    ["GET", `${baseUrl}/discovery/events?limit=20`],
    ["GET", `${baseUrl}/discovery/events/${eventId}`],
    ["GET", `${baseUrl}/discovery/events/${eventId}/availability`],
  ]);

  const valid = responses.every((response) =>
    check(response, {
      "status is 200": (candidate) => candidate.status === 200,
      "response is JSON": (candidate) =>
        String(candidate.headers["Content-Type"] || "").includes(
          "application/json"
        ),
    })
  );
  invariantFailures.add(!valid);
  sleep(0.6);
}
