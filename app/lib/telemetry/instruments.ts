import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("aegis-sre");

/** Total HTTP requests handled, labeled by route. */
export const httpRequestCounter = meter.createCounter("aegis_http_requests_total", {
    description: "Total number of HTTP requests handled by API routes",
});

/** Total HTTP requests that ended in an error, labeled by route. */
export const httpErrorCounter = meter.createCounter("aegis_http_errors_total", {
    description: "Total number of HTTP requests that ended in an error",
});

/** Sum of request durations in ms — paired with the count above computes average latency. */
export const httpDurationSum = meter.createCounter("aegis_http_duration_ms_sum", {
    description: "Sum of request durations in milliseconds",
});

/** Count of requests with a recorded duration — denominator for average latency. */
export const httpDurationCount = meter.createCounter("aegis_http_duration_ms_count", {
    description: "Count of requests with a recorded duration",
});

/** Records a completed request's outcome and duration in one call. */
export function recordRequest(route: string, durationMs: number, isError: boolean): void {
    const attrs = { route };
    httpRequestCounter.add(1, attrs);
    httpDurationSum.add(durationMs, attrs);
    httpDurationCount.add(1, attrs);
    if (isError) httpErrorCounter.add(1, attrs);
}
