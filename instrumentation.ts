import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { HostMetricsInstrumentation } from "@opentelemetry/instrumentation-host-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { installConsoleBridge } from "./lib/console-bridge";

/**
 * Parses the standard OTEL_EXPORTER_OTLP_HEADERS format:
 * comma-separated key=value pairs, e.g. "signoz-ingestion-key=abc,x-foo=bar".
 * Only needed for SigNoz Cloud (ingestion auth) — empty/unset for a local
 * self-hosted collector.
 */
function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const entries = raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      return idx === -1 ? null : [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
    })
    .filter((e): e is [string, string] => e !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function resolveUrl(endpoint: string, signal: "traces" | "metrics" | "logs"): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  const suffix = `/v1/${signal}`;
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}

const serviceName = process.env.OTEL_SERVICE_NAME ?? "aegis-sre";
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  }),

  traceExporter: new OTLPTraceExporter({
    url: resolveUrl(endpoint, "traces"),
    headers,
  }),

  // Ingestion into SigNoz's OTel collector needs no auth (that's separate
  // from the query-service API used to read metrics back out — see
  // app/lib/telemetry/signoz.ts for that side).
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: resolveUrl(endpoint, "metrics"),
      headers,
    }),
    exportIntervalMillis: 15000,
  }),

  // Captures console.log/warn/error via lib/console-bridge.ts (installed
  // below, after sdk.start() registers the global LoggerProvider).
  logRecordProcessors: [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: resolveUrl(endpoint, "logs"),
        headers,
      }),
    }),
  ],

  instrumentations: [
    getNodeAutoInstrumentations(),
    // Emits process.cpu.utilization / process.memory.usage — real Node
    // process metrics, not container-level stats (this app isn't
    // containerized). See app/lib/telemetry/signoz.ts for the matching
    // PromQL queries.
    new HostMetricsInstrumentation({
      metricGroups: ["process.cpu", "process.memory"],
    }),
  ],
});

export async function register() {
  // Only meaningful in the Node.js runtime — the Edge runtime has no OTel SDK support.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  sdk.start();
  // Must run after sdk.start() — that's what registers the global
  // LoggerProvider this bridge sends log records through.
  installConsoleBridge();

  console.log(
    `[otel] initialized — service="${serviceName}" exporting traces+metrics+logs to ${endpoint}`
  );
}
