const durationBucketsSeconds = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

interface MetricValues {
  count: number;
  durationSeconds: number;
  buckets: number[];
}

function metricLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function normalizeMetricPath(path: string): string {
  return (
    path
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
        "/:id"
      )
      .replace(/\/\d+(?=\/|$)/g, "/:id")
      .slice(0, 200) || "/"
  );
}

export class HttpMetrics {
  private readonly values = new Map<string, MetricValues>();

  record(input: {
    durationSeconds: number;
    method: string;
    path: string;
    statusCode: number;
  }): void {
    const labels = [
      input.method.toUpperCase(),
      normalizeMetricPath(input.path),
      String(input.statusCode),
    ];
    const key = JSON.stringify(labels);
    const metric = this.values.get(key) ?? {
      buckets: durationBucketsSeconds.map(() => 0),
      count: 0,
      durationSeconds: 0,
    };
    metric.count += 1;
    metric.durationSeconds += input.durationSeconds;
    durationBucketsSeconds.forEach((bucket, index) => {
      if (input.durationSeconds <= bucket) {
        metric.buckets[index]! += 1;
      }
    });
    this.values.set(key, metric);
  }

  render(): string {
    const lines = [
      "# HELP event_ticketing_http_requests_total Completed HTTP requests.",
      "# TYPE event_ticketing_http_requests_total counter",
    ];
    for (const [key, metric] of [...this.values.entries()].sort()) {
      const [method, path, status] = JSON.parse(key) as string[];
      const labels = `method="${metricLabel(method!)}",path="${metricLabel(path!)}",status="${metricLabel(status!)}"`;
      lines.push(
        `event_ticketing_http_requests_total{${labels}} ${metric.count}`
      );
    }
    lines.push(
      "# HELP event_ticketing_http_request_duration_seconds HTTP request duration.",
      "# TYPE event_ticketing_http_request_duration_seconds histogram"
    );
    for (const [key, metric] of [...this.values.entries()].sort()) {
      const [method, path, status] = JSON.parse(key) as string[];
      const labels = `method="${metricLabel(method!)}",path="${metricLabel(path!)}",status="${metricLabel(status!)}"`;
      durationBucketsSeconds.forEach((bucket, index) => {
        lines.push(
          `event_ticketing_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${metric.buckets[index]}`
        );
      });
      lines.push(
        `event_ticketing_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`,
        `event_ticketing_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds}`,
        `event_ticketing_http_request_duration_seconds_count{${labels}} ${metric.count}`
      );
    }
    return `${lines.join("\n")}\n`;
  }
}
