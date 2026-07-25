import { hostname } from "node:os";
import type { IncidentStatus, RuntimeInfo } from "./types";

export const TERMINAL_STATUSES: readonly IncidentStatus[] = [
    "RESOLVED",
    "FAILED",
    "AWAITING_REVIEW",
] as const;

export function isTerminalStatus(status: IncidentStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

export function joinUrl(base: string, path: string): string {
    const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const trimmedPath = path.startsWith("/") ? path : `/${path}`;
    return trimmedBase + trimmedPath;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

type ProcessLike = {
    pid?: number;
    platform?: string;
    version?: string;
    env?: Record<string, string | undefined>;
};

function getProcess(): ProcessLike | undefined {
    return (globalThis as { process?: ProcessLike }).process;
}

/**
 * Collect Node.js runtime metadata. Safe in non-Node contexts —
 * returns whatever fields are actually available.
 */
export function collectRuntime(): RuntimeInfo {
    const info: RuntimeInfo = {};
    const proc = getProcess();
    if (proc) {
        if (typeof proc.pid === "number") info.pid = proc.pid;
        if (typeof proc.platform === "string") info.platform = proc.platform;
        if (typeof proc.version === "string") info.nodeVersion = proc.version;
    }
    try {
        info.hostname = hostname();
    } catch {
        // Non-Node runtime or hostname unavailable — skip.
    }
    return info;
}

/** Prefer AEGIS_ENV, then NODE_ENV. Undefined if neither is set. */
export function detectEnvironment(): string | undefined {
    const env = getProcess()?.env;
    if (!env) return undefined;
    return env.AEGIS_ENV ?? env.NODE_ENV;
}

/**
 * Merge default + per-call metadata into one object.
 * Returns undefined if the result would be empty (keeps payloads clean).
 */
export function mergeMetadata(
    ...sources: (Record<string, unknown> | undefined)[]
): Record<string, unknown> | undefined {
    const nonEmpty = sources.filter(
        (s): s is Record<string, unknown> => !!s && Object.keys(s).length > 0
    );
    if (nonEmpty.length === 0) return undefined;
    return Object.assign({}, ...nonEmpty);
}
