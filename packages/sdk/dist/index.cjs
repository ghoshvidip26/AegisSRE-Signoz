'use strict';

var os = require('os');

// src/errors.ts
var AegisError = class extends Error {
  constructor(message, options) {
    super(message);
    this.name = "AegisError";
    if (options?.cause !== void 0) {
      this.cause = options.cause;
    }
  }
};
var AegisApiError = class extends AegisError {
  status;
  body;
  constructor(status, body, message) {
    super(message ?? `AegisSRE API returned ${status}`);
    this.name = "AegisApiError";
    this.status = status;
    this.body = body;
  }
};
var AegisNetworkError = class extends AegisError {
  constructor(message, options) {
    super(message, options);
    this.name = "AegisNetworkError";
  }
};
var AegisTimeoutError = class extends AegisError {
  constructor(message) {
    super(message);
    this.name = "AegisTimeoutError";
  }
};
var TERMINAL_STATUSES = [
  "RESOLVED",
  "FAILED",
  "AWAITING_REVIEW"
];
function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}
function joinUrl(base, path) {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return trimmedBase + trimmedPath;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function getProcess() {
  return globalThis.process;
}
function collectRuntime() {
  const info = {};
  const proc = getProcess();
  if (proc) {
    if (typeof proc.pid === "number") info.pid = proc.pid;
    if (typeof proc.platform === "string") info.platform = proc.platform;
    if (typeof proc.version === "string") info.nodeVersion = proc.version;
  }
  try {
    info.hostname = os.hostname();
  } catch {
  }
  return info;
}
function detectEnvironment() {
  const env = getProcess()?.env;
  if (!env) return void 0;
  return env.AEGIS_ENV ?? env.NODE_ENV;
}
function mergeMetadata(...sources) {
  const nonEmpty = sources.filter(
    (s) => !!s && Object.keys(s).length > 0
  );
  if (nonEmpty.length === 0) return void 0;
  return Object.assign({}, ...nonEmpty);
}

// src/client.ts
var DEFAULT_TIMEOUT_MS = 1e4;
var DEFAULT_WAIT_TIMEOUT_MS = 5 * 6e4;
var DEFAULT_WAIT_INTERVAL_MS = 2e3;
var AegisClient = class {
  baseUrl;
  service;
  apiKey;
  environment;
  defaultMetadata;
  timeoutMs;
  fetchImpl;
  uncaughtHandler;
  rejectionHandler;
  handlersInstalled = false;
  constructor(options) {
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
  async capture(error, options = {}) {
    const { message, stack } = extractErrorFields(error);
    return this.send(
      this.buildPayload({
        message,
        stack,
        metadata: options.metadata,
        service: options.service,
        environment: options.environment
      })
    );
  }
  /** Report a non-Error event with a raw message. */
  async report(options) {
    if (!options || typeof options.message !== "string" || options.message.trim() === "") {
      throw new AegisError("aegis.report: message is required");
    }
    return this.send(
      this.buildPayload({
        message: options.message,
        metadata: options.metadata,
        service: options.service,
        environment: options.environment
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
  installGlobalHandlers(options = {}) {
    if (this.handlersInstalled) return;
    const proc = globalThis.process;
    if (!proc || typeof proc.on !== "function") {
      throw new AegisError(
        "installGlobalHandlers: requires a Node.js process object (not available in this runtime)"
      );
    }
    const exitOnCapture = options.exitOnCapture ?? true;
    const reportTimeoutMs = options.reportTimeoutMs ?? 3e3;
    const handle = (error, origin) => {
      const reported = this.capture(error, { metadata: { origin } }).catch((captureErr) => {
        console.error("[aegis-sre] failed to report error:", captureErr);
        return void 0;
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
  uninstallGlobalHandlers() {
    if (!this.handlersInstalled) return;
    const proc = globalThis.process;
    if (proc) {
      if (this.uncaughtHandler) proc.off("uncaughtException", this.uncaughtHandler);
      if (this.rejectionHandler) proc.off("unhandledRejection", this.rejectionHandler);
    }
    this.uncaughtHandler = void 0;
    this.rejectionHandler = void 0;
    this.handlersInstalled = false;
  }
  /** GET /api/incidents/:id — fetch a single incident. */
  async getIncident(id) {
    const res = await this.request(
      `/api/incidents/${encodeURIComponent(id)}`,
      { method: "GET" }
    );
    return res.incident;
  }
  /** GET /api/incidents — list all incidents. */
  async listIncidents() {
    const res = await this.request(
      "/api/incidents",
      { method: "GET" }
    );
    return res.incident;
  }
  /**
   * Poll `getIncident(id)` until the status is terminal
   * (RESOLVED, FAILED, or AWAITING_REVIEW) or the timeout elapses.
   */
  async waitForResolution(id, options = {}) {
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
  buildPayload(input) {
    const payload = {
      service: input.service?.trim() || this.service,
      message: input.message,
      runtime: collectRuntime(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (input.stack) payload.stack = input.stack;
    const env = input.environment ?? this.environment;
    if (env) payload.environment = env;
    const meta = mergeMetadata(this.defaultMetadata, input.metadata);
    if (meta) payload.metadata = meta;
    return payload;
  }
  async send(payload) {
    const res = await this.request(
      "/api/incidents",
      { method: "POST", body: JSON.stringify(payload) }
    );
    return res.incident;
  }
  async request(path, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (init.headers) {
      for (const [k, v] of Object.entries(
        init.headers
      )) {
        headers[k] = v;
      }
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    let response;
    try {
      response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
        ...init,
        headers,
        signal: controller.signal
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new AegisTimeoutError(
          `Request to ${path} exceeded ${this.timeoutMs}ms`
        );
      }
      throw new AegisNetworkError(
        `Network error contacting ${path}: ${err.message}`,
        { cause: err }
      );
    } finally {
      clearTimeout(timer);
    }
    const body = await parseBody(response);
    if (!response.ok) {
      throw new AegisApiError(response.status, body);
    }
    return body;
  }
};
function extractErrorFields(error) {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Unknown error",
      stack: error.stack
    };
  }
  if (typeof error === "string" && error.trim() !== "") {
    return { message: error };
  }
  if (error && typeof error === "object") {
    const obj = error;
    if (typeof obj.message === "string" && obj.message.trim() !== "") {
      return {
        message: obj.message,
        stack: typeof obj.stack === "string" ? obj.stack : void 0
      };
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return { message: serialized };
      }
    } catch {
    }
    return { message: "Unknown non-Error object thrown" };
  }
  if (error === void 0 || error === null) {
    return { message: `Unknown ${error === null ? "null" : "undefined"} value thrown` };
  }
  return { message: String(error) };
}
async function parseBody(response) {
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

exports.AegisApiError = AegisApiError;
exports.AegisClient = AegisClient;
exports.AegisError = AegisError;
exports.AegisNetworkError = AegisNetworkError;
exports.AegisTimeoutError = AegisTimeoutError;
exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
exports.isTerminalStatus = isTerminalStatus;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map