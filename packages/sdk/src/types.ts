export type LogLevel = "INFO" | "WARN" | "ERROR";
export type IncidentSeverity = "P1" | "P2" | "P3" | "P4";

export type IncidentStatus =
    | "OPEN"
    | "TRIAGING"
    | "DIAGNOSING"
    | "DIAGNOSED"
    | "PLANNING"
    | "EXECUTING"
    | "RESOLVED"
    | "FAILED"
    | "AWAITING_REVIEW";

export interface IncidentLog {
    timestamp: string;
    level: LogLevel;
    message: string;
}

export interface RuntimeInfo {
    nodeVersion?: string;
    platform?: string;
    pid?: number;
    hostname?: string;
}

/** Raw shape the SDK posts to POST /api/incidents. */
export interface IncidentPayload {
    service: string;
    message: string;
    stack?: string;
    runtime?: RuntimeInfo;
    environment?: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
}

/** Options for `aegis.capture(error, options)`. */
export interface CaptureOptions {
    metadata?: Record<string, unknown>;
    /** Override the client's default service for this event. */
    service?: string;
    /** Override the client's default environment for this event. */
    environment?: string;
}

/** Options for `aegis.report({ message, ... })`. */
export interface ReportOptions {
    message: string;
    metadata?: Record<string, unknown>;
    service?: string;
    environment?: string;
}

/**
 * Incident as returned by the server.
 * The Runtime fills in classifier / diagnosis / status transitions —
 * the SDK never sets these fields.
 */
export interface Incident {
    id: string;
    service: string;
    message: string;
    title?: string;
    severity?: IncidentSeverity;
    stack?: string;
    runtime?: RuntimeInfo;
    environment?: string;
    metadata?: Record<string, unknown>;
    category?: string;
    classifierService?: string;
    classifierConfidence?: number;
    status: IncidentStatus;
    logs: IncidentLog[];
    failedStep?: string;
    failureReason?: string;
    retryCount?: number;
    operationsLog?: string[];
    createdAt: string;
}

export interface AegisClientOptions {
    /** Base URL of the AegisSRE deployment, e.g. "http://localhost:3000". */
    baseUrl: string;
    /** Service name applied to every incident from this client. Required. */
    service: string;
    /** Optional bearer token sent as `Authorization: Bearer <apiKey>`. */
    apiKey?: string;
    /** Environment label; auto-detects from NODE_ENV / AEGIS_ENV if omitted. */
    environment?: string;
    /** Metadata merged into every incident payload. */
    defaultMetadata?: Record<string, unknown>;
    /** Per-request timeout in ms (default: 10_000). */
    timeoutMs?: number;
    /** Custom fetch implementation (useful for testing). */
    fetch?: typeof fetch;
}

export interface WaitOptions {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
}

/** Options for `aegis.installGlobalHandlers()`. */
export interface InstallOptions {
    /**
     * Exit the process after reporting an uncaught exception / unhandled
     * rejection (default: true).
     *
     * Node's own default behavior is to crash on both — registering a handler
     * suppresses that. Reporting-without-exiting leaves the process running
     * in a state Node explicitly warns is unsafe. Set to false only if you
     * have your own supervisor/restart strategy and understand the risk.
     */
    exitOnCapture?: boolean;
    /** Max time to wait for the report to reach the server before exiting anyway (default: 3000ms). */
    reportTimeoutMs?: number;
    /**
     * Called after an auto-captured error has been reported to the Runtime.
     * Errors thrown inside this callback are caught and logged, never rethrown.
     * Useful for logging the incident id, or (in scripts/tests with
     * `exitOnCapture: false`) awaiting resolution.
     */
    onCaptured?: (
        incident: Incident,
        origin: "uncaughtException" | "unhandledRejection"
    ) => void | Promise<void>;
}
