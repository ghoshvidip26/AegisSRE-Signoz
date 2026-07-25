import {
    AegisApiError,
    AegisError,
    AegisNetworkError,
    AegisTimeoutError,
} from "./errors";
import type {
    AegisClientOptions,
    CaptureOptions,
    Incident,
    IncidentPayload,
    InstallOptions,
    ReportOptions,
    WaitOptions,
} from "./types";
import {
    collectRuntime,
    detectEnvironment,
    isTerminalStatus,
    joinUrl,
    mergeMetadata,
    sleep,
} from "./utils";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_WAIT_INTERVAL_MS = 2_000;

export class AegisClient {
    private readonly baseUrl: string;
    private readonly service: string;
    private readonly apiKey: string | undefined;
    private readonly environment: string | undefined;
    private readonly defaultMetadata: Record<string, unknown> | undefined;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;
    private uncaughtHandler?: (err: unknown) => void;
    private rejectionHandler?: (reason: unknown) => void;
    private handlersInstalled = false;

    constructor(options: AegisClientOptions) {
        if (!options?.baseUrl || options.baseUrl.trim() === "") {
            throw new AegisError("AegisClient: baseUrl is required");
        }
        if (!options?.service || options.service.trim() === "") {
            throw new AegisError("AegisClient: service is required");
        }
        this.baseUrl = options.baseUrl;
        this.service = options.service;
        this.apiKey = options.apiKey;
        this.environment = options.environment ?? detectEnvironment();
        this.defaultMetadata = options.defaultMetadata;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        const impl = options.fetch ?? globalThis.fetch;
        if (typeof impl !== "function") {
            throw new AegisError(
                "AegisClient: fetch is not available. Use Node.js 18+ or pass options.fetch."
            );
        }
        this.fetchImpl = impl;
    }

    /**
     * Capture an Error (or any thrown value) and forward to the Runtime.
     * Extracts message + stack, auto-collects runtime metadata.
     *
     * The SDK never inspects the message to guess category or severity —
     * that is entirely the Runtime's job.
     */
    async capture(error: unknown, options: CaptureOptions = {}): Promise<Incident> {
        const { message, stack } = extractErrorFields(error);

        return this.send(
            this.buildPayload({
                message,
                stack,
                metadata: options.metadata,
                service: options.service,
                environment: options.environment,
            })
        );
    }

    /** Report a non-Error event with a raw message. */
    async report(options: ReportOptions): Promise<Incident> {
        if (
            !options ||
            typeof options.message !== "string" ||
            options.message.trim() === ""
        ) {
            throw new AegisError("aegis.report: message is required");
        }
        return this.send(
            this.buildPayload({
                message: options.message,
                metadata: options.metadata,
                service: options.service,
                environment: options.environment,
            })
        );
    }

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
    installGlobalHandlers(options: InstallOptions = {}): void {
        if (this.handlersInstalled) return;

        const proc = (globalThis as { process?: NodeJS.Process }).process;
        if (!proc || typeof proc.on !== "function") {
            throw new AegisError(
                "installGlobalHandlers: requires a Node.js process object (not available in this runtime)"
            );
        }

        const exitOnCapture = options.exitOnCapture ?? true;
        const reportTimeoutMs = options.reportTimeoutMs ?? 3000;

        const handle = (error: unknown, origin: "uncaughtException" | "unhandledRejection") => {
            const reported = this.capture(error, { metadata: { origin } }).catch((captureErr) => {
                console.error("[aegis-sre] failed to report error:", captureErr);
                return undefined;
            });

            const settled = reported.then(async (incident) => {
                if (!incident || !options.onCaptured) return;
                try {
                    await options.onCaptured(incident, origin);
                } catch (callbackErr) {
                    console.error("[aegis-sre] onCaptured callback threw:", callbackErr);
                }
            });

            if (exitOnCapture) {
                Promise.race([settled, sleep(reportTimeoutMs)]).finally(() => {
                    proc.exit(1);
                });
            }
        };

        this.uncaughtHandler = (err) => handle(err, "uncaughtException");
        this.rejectionHandler = (reason) => handle(reason, "unhandledRejection");

        proc.on("uncaughtException", this.uncaughtHandler);
        proc.on("unhandledRejection", this.rejectionHandler);
        this.handlersInstalled = true;
    }

    /** Remove handlers registered by `installGlobalHandlers()`. Idempotent. */
    uninstallGlobalHandlers(): void {
        if (!this.handlersInstalled) return;
        const proc = (globalThis as { process?: NodeJS.Process }).process;
        if (proc) {
            if (this.uncaughtHandler) proc.off("uncaughtException", this.uncaughtHandler);
            if (this.rejectionHandler) proc.off("unhandledRejection", this.rejectionHandler);
        }
        this.uncaughtHandler = undefined;
        this.rejectionHandler = undefined;
        this.handlersInstalled = false;
    }

    /** GET /api/incidents/:id — fetch a single incident. */
    async getIncident(id: string): Promise<Incident> {
        const res = await this.request<{ incident: Incident }>(
            `/api/incidents/${encodeURIComponent(id)}`,
            { method: "GET" }
        );
        return res.incident;
    }

    /** GET /api/incidents — list all incidents. */
    async listIncidents(): Promise<Incident[]> {
        const res = await this.request<{ incident: Incident[] }>(
            "/api/incidents",
            { method: "GET" }
        );
        return res.incident;
    }

    /**
     * Poll `getIncident(id)` until the status is terminal
     * (RESOLVED, FAILED, or AWAITING_REVIEW) or the timeout elapses.
     */
    async waitForResolution(
        id: string,
        options: WaitOptions = {}
    ): Promise<Incident> {
        const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
        const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
        const deadline = Date.now() + timeoutMs;

        while (true) {
            const incident = await this.getIncident(id);
            if (isTerminalStatus(incident.status)) return incident;
            if (Date.now() >= deadline) {
                throw new AegisTimeoutError(
                    `Incident ${id} did not reach a terminal state within ${timeoutMs}ms (last status: ${incident.status})`
                );
            }
            await sleep(intervalMs, options.signal);
        }
    }

    private buildPayload(input: {
        message: string;
        stack?: string;
        service?: string;
        environment?: string;
        metadata?: Record<string, unknown>;
    }): IncidentPayload {
        const payload: IncidentPayload = {
            service: input.service?.trim() || this.service,
            message: input.message,
            runtime: collectRuntime(),
            timestamp: new Date().toISOString(),
        };
        if (input.stack) payload.stack = input.stack;
        const env = input.environment ?? this.environment;
        if (env) payload.environment = env;
        const meta = mergeMetadata(this.defaultMetadata, input.metadata);
        if (meta) payload.metadata = meta;
        return payload;
    }

    private async send(payload: IncidentPayload): Promise<Incident> {
        const res = await this.request<{ success: boolean; incident: Incident }>(
            "/api/incidents",
            { method: "POST", body: JSON.stringify(payload) }
        );
        return res.incident;
    }

    private async request<T>(path: string, init: RequestInit): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Accept: "application/json",
        };
        if (init.headers) {
            for (const [k, v] of Object.entries(
                init.headers as Record<string, string>
            )) {
                headers[k] = v;
            }
        }
        if (this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }

        let response: Response;
        try {
            response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
                ...init,
                headers,
                signal: controller.signal,
            });
        } catch (err) {
            if ((err as { name?: string }).name === "AbortError") {
                throw new AegisTimeoutError(
                    `Request to ${path} exceeded ${this.timeoutMs}ms`
                );
            }
            throw new AegisNetworkError(
                `Network error contacting ${path}: ${(err as Error).message}`,
                { cause: err }
            );
        } finally {
            clearTimeout(timer);
        }

        const body = await parseBody(response);

        if (!response.ok) {
            throw new AegisApiError(response.status, body);
        }

        return body as T;
    }
}

/**
 * Extract a usable message + stack from anything a caller might throw.
 * Avoids the `String({}) === "[object Object]"` trap.
 */
function extractErrorFields(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
        return {
            message: error.message || error.name || "Unknown error",
            stack: error.stack,
        };
    }
    if (typeof error === "string" && error.trim() !== "") {
        return { message: error };
    }
    if (error && typeof error === "object") {
        const obj = error as { message?: unknown; stack?: unknown };
        if (typeof obj.message === "string" && obj.message.trim() !== "") {
            return {
                message: obj.message,
                stack: typeof obj.stack === "string" ? obj.stack : undefined,
            };
        }
        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== "{}") {
                return { message: serialized };
            }
        } catch {
            // fall through to generic label
        }
        return { message: "Unknown non-Error object thrown" };
    }
    if (error === undefined || error === null) {
        return { message: `Unknown ${error === null ? "null" : "undefined"} value thrown` };
    }
    return { message: String(error) };
}

async function parseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        try {
            return await response.json();
        } catch {
            return null;
        }
    }
    try {
        return await response.text();
    } catch {
        return null;
    }
}
