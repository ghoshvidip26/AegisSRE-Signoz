type LogLevel = "INFO" | "WARN" | "ERROR";
type IncidentSeverity = "P1" | "P2" | "P3" | "P4";
type IncidentStatus = "OPEN" | "TRIAGING" | "DIAGNOSING" | "DIAGNOSED" | "PLANNING" | "EXECUTING" | "RESOLVED" | "FAILED" | "AWAITING_REVIEW";
interface IncidentLog {
    timestamp: string;
    level: LogLevel;
    message: string;
}
interface RuntimeInfo {
    nodeVersion?: string;
    platform?: string;
    pid?: number;
    hostname?: string;
}
/** Raw shape the SDK posts to POST /api/incidents. */
interface IncidentPayload {
    service: string;
    message: string;
    stack?: string;
    runtime?: RuntimeInfo;
    environment?: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
}
/** Options for `aegis.capture(error, options)`. */
interface CaptureOptions {
    metadata?: Record<string, unknown>;
    /** Override the client's default service for this event. */
    service?: string;
    /** Override the client's default environment for this event. */
    environment?: string;
}
/** Options for `aegis.report({ message, ... })`. */
interface ReportOptions {
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
interface Incident {
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
interface AegisClientOptions {
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
interface WaitOptions {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
}
/** Options for `aegis.installGlobalHandlers()`. */
interface InstallOptions {
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
    onCaptured?: (incident: Incident, origin: "uncaughtException" | "unhandledRejection") => void | Promise<void>;
}

declare class AegisClient {
    private readonly baseUrl;
    private readonly service;
    private readonly apiKey;
    private readonly environment;
    private readonly defaultMetadata;
    private readonly timeoutMs;
    private readonly fetchImpl;
    private uncaughtHandler?;
    private rejectionHandler?;
    private handlersInstalled;
    constructor(options: AegisClientOptions);
    /**
     * Capture an Error (or any thrown value) and forward to the Runtime.
     * Extracts message + stack, auto-collects runtime metadata.
     *
     * The SDK never inspects the message to guess category or severity —
     * that is entirely the Runtime's job.
     */
    capture(error: unknown, options?: CaptureOptions): Promise<Incident>;
    /** Report a non-Error event with a raw message. */
    report(options: ReportOptions): Promise<Incident>;
    /**
     * Register global `uncaughtException` / `unhandledRejection` handlers so
     * errors are reported automatically without an explicit try/catch at
     * every call site. Call once, near your app's entrypoint:
     *
     *   const aegis = new AegisClient({ baseUrl, service: "payments-api" });
     *   aegis.installGlobalHandlers();
     *
     * By default the process exits after reporting (matching Node's own
     * default crash behavior for both event types — see InstallOptions).
     * Idempotent: calling twice is a no-op.
     */
    installGlobalHandlers(options?: InstallOptions): void;
    /** Remove handlers registered by `installGlobalHandlers()`. Idempotent. */
    uninstallGlobalHandlers(): void;
    /** GET /api/incidents/:id — fetch a single incident. */
    getIncident(id: string): Promise<Incident>;
    /** GET /api/incidents — list all incidents. */
    listIncidents(): Promise<Incident[]>;
    /**
     * Poll `getIncident(id)` until the status is terminal
     * (RESOLVED, FAILED, or AWAITING_REVIEW) or the timeout elapses.
     */
    waitForResolution(id: string, options?: WaitOptions): Promise<Incident>;
    private buildPayload;
    private send;
    private request;
}

declare class AegisError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
declare class AegisApiError extends AegisError {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, body: unknown, message?: string);
}
declare class AegisNetworkError extends AegisError {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
declare class AegisTimeoutError extends AegisError {
    constructor(message: string);
}

declare const TERMINAL_STATUSES: readonly IncidentStatus[];
declare function isTerminalStatus(status: IncidentStatus): boolean;

export { AegisApiError, AegisClient, type AegisClientOptions, AegisError, AegisNetworkError, AegisTimeoutError, type CaptureOptions, type Incident, type IncidentLog, type IncidentPayload, type IncidentSeverity, type IncidentStatus, type InstallOptions, type LogLevel, type ReportOptions, type RuntimeInfo, TERMINAL_STATUSES, type WaitOptions, isTerminalStatus };
