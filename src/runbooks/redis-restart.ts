import { register } from "./registry";
import type { Runbook } from "./types";

function parseConnectedClients(infoOutput: string | undefined): number | null {
    const match = infoOutput?.match(/connected_clients:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

export const redisRestartRunbook: Runbook = {
    id: "redis-restart",
    description: "Restart local Redis when it's unreachable or the connection pool is exhausted.",
    riskTier: "medium",

    match(diagnosis) {
        const text = `${diagnosis.rootCause} ${diagnosis.recommendation}`.toLowerCase();
        const service = diagnosis.affectedService.toLowerCase();

        const isRedis = service.includes("redis") || text.includes("redis");
        const isConnectivityIssue =
            text.includes("connection refused") ||
            text.includes("connection failed") ||
            text.includes("pool saturated") ||
            text.includes("pool exhausted") ||
            diagnosis.category === "cache_unavailable";

        if (isRedis && isConnectivityIssue) {
            return { confidence: 0.9, reason: "Redis service with connection-level failure" };
        }
        if (isRedis) {
            return { confidence: 0.6, reason: "Redis-related diagnosis, no specific failure signal" };
        }
        return { confidence: 0, reason: "No Redis signal in diagnosis" };
    },

    async execute(_diagnosis, { executor }) {
        // Real "before" snapshot — measure actual ping outcome/latency
        // rather than assuming DOWN just because the diagnosis said so.
        const beforeStart = Date.now();
        const beforePing = await executor.run("redis-cli ping", { timeoutMs: 3000, label: "redis-cli ping (before)" });
        const beforeLatencyMs = Date.now() - beforeStart;
        const beforeUp = beforePing.ok && beforePing.stdout?.trim() === "PONG";

        const start = await executor.run("redis-server --daemonize yes", { timeoutMs: 5000 });

        const afterStart = Date.now();
        const ping = await executor.run("redis-cli ping", { timeoutMs: 3000, label: "redis-cli ping (after)" });
        const afterLatencyMs = Date.now() - afterStart;
        const responded = ping.ok && ping.stdout?.trim() === "PONG";

        let connections: number | null = null;
        if (responded) {
            const info = await executor.run("redis-cli info clients", { timeoutMs: 3000 });
            connections = parseConnectedClients(info.stdout);
        }

        return {
            status: responded ? "success" : "failed",
            summary: responded
                ? "Redis restarted and responding to PING"
                : "Restart attempted but Redis did not return PONG",
            steps: [
                { command: "redis-cli ping (before)", result: beforePing },
                { command: "redis-server --daemonize yes", result: start },
                { command: "redis-cli ping (after)", result: ping },
            ],
            telemetry: {
                redis: {
                    before: {
                        status: beforeUp ? "UP" : "DOWN",
                        latencyMs: beforeUp ? beforeLatencyMs : null,
                    },
                    after: {
                        status: responded ? "UP" : "DOWN",
                        latencyMs: responded ? afterLatencyMs : null,
                        connections,
                    },
                },
            },
        };
    },

    async verify(_diagnosis, { executor }) {
        const MAX_CHECKS = 3;
        const CHECK_INTERVAL_MS = 4000;
        const evidence: string[] = [];

        for (let attempt = 1; attempt <= MAX_CHECKS; attempt++) {
            const pingStart = Date.now();
            const ping = await executor.run("redis-cli ping", { timeoutMs: 3000 });
            const latencyMs = Date.now() - pingStart;
            const pong = ping.stdout?.trim();
            evidence.push(`attempt ${attempt}: redis-cli ping → ${pong ?? ping.stderr ?? "no output"}`);

            if (ping.ok && pong === "PONG") {
                const info = await executor.run("redis-cli info clients", { timeoutMs: 3000 });
                return {
                    resolved: true,
                    evidence,
                    // Nested under "after" — matches execute()'s {before, after}
                    // shape so this doesn't clobber the pre-fix snapshot when
                    // merged onto the incident record (see incident-workflow.ts's
                    // mergeTelemetry, which shallow-merges one level deep).
                    telemetry: {
                        redis: {
                            after: {
                                status: "UP",
                                latencyMs,
                                connections: parseConnectedClients(info.stdout),
                            },
                        },
                    },
                };
            }
            if (attempt < MAX_CHECKS) {
                await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MS));
            }
        }
        return {
            resolved: false,
            evidence,
            telemetry: { redis: { after: { status: "DOWN", latencyMs: null, connections: null } } },
        };
    },
};

register(redisRestartRunbook);
