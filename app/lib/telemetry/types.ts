export interface TelemetryMetrics {
    cpu: number;
    memory: number;
    latency: number;
    errorRate: number;
    requestRate?: number;
    redisStatus?: "UP" | "DOWN";
    activeConnections?: number;
}

export interface TraceSummary {
    traceId: string;
    service: string;
    durationMs: number;
    spanCount: number;
    errorCount: number;
    rootSpan: string;
    startTime: string;
}

export interface TelemetryProvider {
    getMetrics(service: string): Promise<TelemetryMetrics | null>;
    getTrace(traceId: string): Promise<TraceSummary | null>;
}