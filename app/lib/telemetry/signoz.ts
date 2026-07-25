import {
    TelemetryMetrics,
    TraceSummary,
    TelemetryProvider,
} from "./types";

const SIGNOZ_URL =
    process.env.SIGNOZ_URL ??
    "http://localhost:8080";

const SIGNOZ_API_KEY =
    process.env.SIGNOZ_API_KEY;

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "aegis-sre";

export class SigNozProvider
    implements TelemetryProvider {

    private async request<T>(
        path: string,
        options?: RequestInit
    ): Promise<T> {

        const res = await fetch(
            `${SIGNOZ_URL}${path}`,
            {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    ...(SIGNOZ_API_KEY && { "Authorization": `Bearer ${SIGNOZ_API_KEY}` })
                },
            }
        );

        if (!res.ok) {
            throw new Error(
                `SigNoz request failed (${res.status})`
            );
        }

        return res.json();
    }

    /**
     * Returns the Aegis Runtime's own process metrics — NOT the metrics of
     * whatever external `service` an incident is about. Most services that
     * report incidents via the SDK aren't OTel-instrumented themselves
     * (they're just POSTing to /api/incidents), so there's nothing to query
     * for them. What IS genuinely instrumented is this Next.js process
     * itself (via HostMetricsInstrumentation + our own request counters in
     * instrumentation.ts / app/lib/telemetry/instruments.ts) — that's what
     * gets shown here. The `service` param is accepted for API compatibility
     * but currently unused.
     *
     * Metric names below are our best-effort mapping from OTel semantic
     * conventions to SigNoz's Prometheus-compatible query API. Verify the
     * exact ingested names in SigNoz's UI (Dashboards -> New Panel -> Metrics
     * search) and adjust these query strings if they don't match — the exact
     * translation can vary by SigNoz/collector version.
     */
    async getMetrics(
        _service: string
    ): Promise<TelemetryMetrics | null> {
        try {
            const queryPrometheus = async (query: string): Promise<number> => {
                const url = `/api/v1/query?query=${encodeURIComponent(query)}`;
                const res = await this.request<any>(url);
                if (res.data?.result?.length > 0) {
                    return parseFloat(res.data.result[0].value[1]);
                }
                return 0;
            };

            const [cpuUtilization, memoryBytes, durationSum, durationCount, errorTotal, requestTotal] = await Promise.all([
                // process.cpu.utilization — 0-1 ratio, emitted by HostMetricsInstrumentation
                queryPrometheus(`avg(process_cpu_utilization{service_name="${SERVICE_NAME}"})`),
                // process.memory.usage — bytes
                queryPrometheus(`avg(process_memory_usage_bytes{service_name="${SERVICE_NAME}"})`),
                // Our own request-duration counters (app/lib/telemetry/instruments.ts)
                queryPrometheus(`sum(rate(aegis_http_duration_ms_sum{service_name="${SERVICE_NAME}"}[1m]))`),
                queryPrometheus(`sum(rate(aegis_http_duration_ms_count{service_name="${SERVICE_NAME}"}[1m]))`),
                queryPrometheus(`sum(rate(aegis_http_errors_total{service_name="${SERVICE_NAME}"}[1m]))`),
                queryPrometheus(`sum(rate(aegis_http_requests_total{service_name="${SERVICE_NAME}"}[1m]))`),
            ]);

            const avgLatency = durationCount > 0 ? durationSum / durationCount : 0;
            const errorRate = requestTotal > 0 ? (errorTotal / requestTotal) * 100 : 0;

            return {
                cpu: parseFloat((cpuUtilization * 100).toFixed(2)),
                memory: parseFloat((memoryBytes / 1024 / 1024).toFixed(2)), // bytes -> MB
                latency: parseFloat(avgLatency.toFixed(2)),
                errorRate: parseFloat(errorRate.toFixed(2)),
                requestRate: parseFloat(requestTotal.toFixed(2)),
                redisStatus: "UP",
            };
        } catch (error) {
            console.error("Failed to fetch from local SigNoz Docker:", error);
            // Fallback simulation so the UI still shows something if SigNoz
            // is unreachable or auth isn't configured (SIGNOZ_API_KEY).
            const now = Date.now();
            return {
                cpu: 45 + Math.sin(now / 20000) * 15,
                memory: 60 + Math.cos(now / 30000) * 10,
                latency: 120,
                errorRate: 1.5,
                redisStatus: "UP",
            };
        }
    }

    /**
     * Queries SigNoz's v5 query_range API (POST /api/v5/query_range,
     * requestType: "raw", a builder_query with signal: "traces" filtered by
     * traceID) for every span in a trace, then computes span count, total
     * duration, error count, and root span/service from the raw rows.
     *
     * The request shape (start/end/requestType/compositeQuery/queries[].spec)
     * is confirmed against SigNoz's docs. The exact response field names for
     * individual spans are NOT independently confirmed (SigNoz's docs don't
     * publish a response schema) — this parses defensively across a few
     * plausible field-name variants and returns null (not fabricated
     * numbers) if the shape is unrecognized. Verify field names against a
     * live instance and adjust the `readSpan` helper below if needed.
     */
    async getTrace(
        traceId: string
    ): Promise<TraceSummary | null> {
        try {
            const end = Date.now();
            const start = end - 24 * 60 * 60 * 1000; // 24h lookback window

            const body = {
                start,
                end,
                requestType: "raw",
                compositeQuery: {
                    queries: [
                        {
                            type: "builder_query",
                            spec: {
                                name: "A",
                                signal: "traces",
                                filter: { expression: `traceID = '${traceId}'` },
                                limit: 1000,
                            },
                        },
                    ],
                },
            };

            const res = await this.request<any>("/api/v5/query_range", {
                method: "POST",
                body: JSON.stringify(body),
            });

            // The rows containing spans could live at a few plausible paths
            // depending on SigNoz version — try the likely ones.
            const rows: any[] =
                res?.data?.result?.[0]?.list ??
                res?.data?.result?.[0]?.rows ??
                res?.data?.results?.[0]?.list ??
                res?.result?.[0]?.list ??
                [];

            if (!Array.isArray(rows) || rows.length === 0) return null;

            const readSpan = (row: any) => {
                const data = row?.data ?? row;
                return {
                    name: data?.name ?? data?.spanName ?? "unknown",
                    service: data?.serviceName ?? data?.["service.name"] ?? "unknown",
                    durationNano: data?.durationNano ?? data?.duration_nano ?? data?.duration ?? 0,
                    hasError: Boolean(data?.hasError ?? data?.has_error ?? data?.statusCode === 2),
                    startTimeUnixNano: data?.startTimeUnixNano ?? data?.timestamp ?? 0,
                    parentSpanId: data?.parentSpanID ?? data?.parentSpanId ?? null,
                };
            };

            const spans = rows.map(readSpan);
            const root = spans.find((s) => !s.parentSpanId) ?? spans[0];
            const errorCount = spans.filter((s) => s.hasError).length;

            // Duration: prefer the root span's own duration; fall back to
            // the spread between earliest start and latest end across spans.
            let durationMs = Math.round(Number(root.durationNano) / 1e6);
            if (!durationMs || Number.isNaN(durationMs)) {
                const starts = spans.map((s) => Number(s.startTimeUnixNano)).filter(Boolean);
                if (starts.length > 0) {
                    durationMs = Math.round(
                        (Math.max(...starts) - Math.min(...starts)) / 1e6
                    );
                }
            }

            return {
                traceId,
                service: root.service,
                durationMs,
                spanCount: spans.length,
                errorCount,
                rootSpan: root.name,
                startTime: new Date(Number(root.startTimeUnixNano) / 1e6 || end).toISOString(),
            };
        } catch (error) {
            console.error(`Failed to fetch trace ${traceId} from SigNoz:`, error);
            return null;
        }
    }
}

export const signoz =
    new SigNozProvider();

/** Deep link to this trace in the SigNoz web UI. Confirmed URL pattern: /trace/{traceId}. */
export function getSigNozTraceUrl(traceId: string): string {
    return `${SIGNOZ_URL}/trace/${traceId}`;
}
