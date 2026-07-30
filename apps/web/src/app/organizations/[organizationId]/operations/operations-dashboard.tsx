"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import type {
  OperationsJob,
  OrganizationAnalyticsResponse,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../../../lib/auth-api";
import { formatMoney } from "../../../../lib/format";
import { retryOrganizationJob } from "../../../../lib/operations-api";

const timestampFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatTimestamp(iso: string): string {
  return `${timestampFormat.format(new Date(iso))} UTC`;
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "No data";
  }
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(numerator / denominator);
}

function Analytics({
  analytics,
}: Readonly<{ analytics: OrganizationAnalyticsResponse }>): ReactNode {
  return (
    <>
      <section aria-labelledby="sales-heading" className="account-section">
        <h2 id="sales-heading">Sales and refunds</h2>
        <p>
          UTC totals from {analytics.range.from} through {analytics.range.to}.
        </p>
        {analytics.financials.length === 0 ? (
          <p className="form-status">No paid orders in this range.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Tickets</th>
                  <th scope="col">Gross</th>
                  <th scope="col">Fees</th>
                  <th scope="col">Refunds</th>
                  <th scope="col">Net</th>
                </tr>
              </thead>
              <tbody>
                {analytics.financials.map((metric) => (
                  <tr key={metric.currency}>
                    <th scope="row">{metric.currency}</th>
                    <td>{metric.paidOrders}</td>
                    <td>{metric.ticketsSold}</td>
                    <td>{formatMoney(metric.grossMinor, metric.currency)}</td>
                    <td>{formatMoney(metric.feeMinor, metric.currency)}</td>
                    <td>{formatMoney(metric.refundMinor, metric.currency)}</td>
                    <td>{formatMoney(metric.netMinor, metric.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="operations-summary">
          <div>
            <dt>Refunds waiting</dt>
            <dd>{analytics.refunds.requested}</dd>
          </div>
          <div>
            <dt>Refunds completed</dt>
            <dd>{analytics.refunds.succeeded}</dd>
          </div>
          <div>
            <dt>Refunds failed</dt>
            <dd>{analytics.refunds.failed}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="funnel-heading" className="account-section">
        <h2 id="funnel-heading">Purchase funnel</h2>
        <dl className="operations-summary">
          <div>
            <dt>Holds created</dt>
            <dd>{analytics.funnel.holdsCreated}</dd>
          </div>
          <div>
            <dt>Checkout started</dt>
            <dd>{analytics.funnel.checkoutStarted}</dd>
            <small>
              {ratio(
                analytics.funnel.checkoutStarted,
                analytics.funnel.holdsCreated
              )}{" "}
              of holds
            </small>
          </div>
          <div>
            <dt>Paid orders</dt>
            <dd>{analytics.funnel.paidOrders}</dd>
            <small>
              {ratio(
                analytics.funnel.paidOrders,
                analytics.funnel.checkoutStarted
              )}{" "}
              of checkouts
            </small>
          </div>
        </dl>
      </section>

      <section aria-labelledby="inventory-heading" className="account-section">
        <h2 id="inventory-heading">Inventory and entry</h2>
        <dl className="operations-summary operations-summary--five">
          <div>
            <dt>Capacity</dt>
            <dd>{analytics.inventory.capacity}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{analytics.inventory.available}</dd>
          </div>
          <div>
            <dt>Held</dt>
            <dd>{analytics.inventory.held}</dd>
          </div>
          <div>
            <dt>Sold</dt>
            <dd>{analytics.inventory.sold}</dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>{analytics.inventory.blocked}</dd>
          </div>
        </dl>
        <dl className="operations-summary">
          <div>
            <dt>Accepted check-ins</dt>
            <dd>{analytics.checkins.accepted}</dd>
          </div>
          <div>
            <dt>Duplicate scans</dt>
            <dd>{analytics.checkins.duplicate}</dd>
          </div>
          <div>
            <dt>Reversals</dt>
            <dd>{analytics.checkins.reversed}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="daily-heading" className="account-section">
        <h2 id="daily-heading">Daily movement</h2>
        <p>UTC projections update with each source transaction.</p>
        {analytics.dailyFinancials.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Currency</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Tickets</th>
                  <th scope="col">Gross</th>
                  <th scope="col">Refunds</th>
                </tr>
              </thead>
              <tbody>
                {analytics.dailyFinancials.map((metric) => (
                  <tr key={`${metric.date}:${metric.currency}`}>
                    <th scope="row">{metric.date}</th>
                    <td>{metric.currency}</td>
                    <td>{metric.paidOrders}</td>
                    <td>{metric.ticketsSold}</td>
                    <td>{formatMoney(metric.grossMinor, metric.currency)}</td>
                    <td>{formatMoney(metric.refundMinor, metric.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {analytics.dailyActivity.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Holds</th>
                  <th scope="col">Checkouts</th>
                  <th scope="col">Accepted</th>
                  <th scope="col">Duplicates</th>
                  <th scope="col">Reversals</th>
                </tr>
              </thead>
              <tbody>
                {analytics.dailyActivity.map((metric) => (
                  <tr key={metric.date}>
                    <th scope="row">{metric.date}</th>
                    <td>{metric.holdsCreated}</td>
                    <td>{metric.checkoutStarted}</td>
                    <td>{metric.acceptedCheckins}</td>
                    <td>{metric.duplicateScans}</td>
                    <td>{metric.reversedCheckins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {analytics.dailyFinancials.length === 0 &&
        analytics.dailyActivity.length === 0 ? (
          <p className="form-status">No daily activity in this range.</p>
        ) : null}
      </section>
    </>
  );
}

function Jobs({
  apiBaseUrl,
  canRetry,
  jobs,
  organizationId,
}: Readonly<{
  apiBaseUrl: string;
  canRetry: boolean;
  jobs: readonly OperationsJob[];
  organizationId: string;
}>): ReactNode {
  const router = useRouter();
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function retry(job: OperationsJob): Promise<void> {
    setBusyJob(job.id);
    setMessage("");
    try {
      await retryOrganizationJob(
        apiBaseUrl,
        organizationId,
        job.id,
        job.updatedAt
      );
      setMessage(`${job.topic} is queued for another attempt.`);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof AuthApiError
          ? `Error: ${error.message}`
          : "Error: The job could not be retried."
      );
    } finally {
      setBusyJob(null);
    }
  }

  return (
    <section aria-labelledby="jobs-heading" className="account-section">
      <h2 id="jobs-heading">Background jobs</h2>
      <p>
        Payloads stay hidden. Dead letters appear first and keep their stable
        identifiers through a retry.
      </p>
      {jobs.length === 0 ? (
        <p className="form-status">No organization jobs yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table operations-jobs">
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Last change</th>
                <th scope="col">Error</th>
                {canRetry ? <th scope="col">Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <th scope="row">{job.topic}</th>
                  <td>
                    <span className="role-badge" data-status={job.status}>
                      {job.status.replace("_", " ")}
                    </span>
                  </td>
                  <td>
                    {job.attemptCount}/{job.maxAttempts}
                  </td>
                  <td>{formatTimestamp(job.updatedAt)}</td>
                  <td>{job.lastErrorCode ?? "None"}</td>
                  {canRetry ? (
                    <td>
                      {job.status === "dead_letter" ? (
                        <button
                          className="button-quiet"
                          disabled={busyJob !== null}
                          onClick={() => void retry(job)}
                          type="button"
                        >
                          {busyJob === job.id ? "Queuing..." : "Retry"}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p aria-live="polite" className="form-status">
        {message}
      </p>
    </section>
  );
}

export function OperationsDashboard({
  analytics,
  apiBaseUrl,
  canRetryJobs,
  jobs,
  organizationId,
}: Readonly<{
  analytics: OrganizationAnalyticsResponse | null;
  apiBaseUrl: string;
  canRetryJobs: boolean;
  jobs: readonly OperationsJob[] | null;
  organizationId: string;
}>): ReactNode {
  return (
    <>
      {analytics ? <Analytics analytics={analytics} /> : null}
      {jobs ? (
        <Jobs
          apiBaseUrl={apiBaseUrl}
          canRetry={canRetryJobs}
          jobs={jobs}
          organizationId={organizationId}
        />
      ) : null}
    </>
  );
}
