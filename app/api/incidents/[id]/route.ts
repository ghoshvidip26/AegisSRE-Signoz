import { NextRequest, NextResponse } from "next/server";
import { incidentStore } from "@/lib/incidents/incident-store";
import { tracer } from "@/lib/tracing";
import { SpanStatusCode } from "@opentelemetry/api";
import { getServiceMetrics } from "../../../lib/telemetry/metrics";
import { recordRequest } from "@/app/lib/telemetry/instruments";
import { groupStages } from "@/lib/incidents/workflow-stages";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const start = performance.now();
    return tracer.startActiveSpan("Get Incident", async (span) => {
        let isError = false;
        try {
            const { id } = await params;
            const incident = incidentStore.get(id);
            span.setAttribute("incident.id", id);

            if (!incident) {
                isError = true;
                span.setStatus({ code: SpanStatusCode.ERROR, message: "Incident not found" });
                return NextResponse.json({ error: "Incident not found" }, { status: 404 });
            }
            span.setAttribute("incident.status", incident.status);

            // Fetch live metrics for the affected service
            let liveMetrics = incident.metrics ?? null;
            if (incident.service) {
                try {
                    const fetchedMetrics = await getServiceMetrics(incident.service);
                    if (fetchedMetrics) {
                        liveMetrics = {
                            cpu: fetchedMetrics.cpu,
                            memory: fetchedMetrics.memory,
                            errorRate: fetchedMetrics.errorRate,
                            latency: fetchedMetrics.latency,
                            redisStatus: fetchedMetrics.redisStatus,
                        };
                    }
                } catch (error) {
                    console.error(`Failed to fetch live metrics for ${incident.service}:`, error);
                }
            }

            // Derived from the real operations log (single source of truth —
            // see lib/incidents/workflow-stages.ts), not a hand-maintained
            // status-string switch that could silently drift from reality.
            const pipeline = pipelineFromStages(incident.operationsLog ?? [], incident.status);

            return NextResponse.json({
                incident,
                pipeline,
                metrics: liveMetrics,
                operationsLog: incident.operationsLog ?? [],
            });
        } catch (err) {
            isError = true;
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
        } finally {
            span.end();
            recordRequest("GET /api/incidents/:id", performance.now() - start, isError);
        }
    })
}

/**
 * Returns both the legacy 4-key shape (diagnose/plan/execute/verify — kept
 * for existing consumers: context-panel.tsx's stepper, workflow-canvas.tsx's
 * current 6-node layout) and 3 new keys (coordinator/classify/approval) for
 * the linear 7-stage view. All 7 are now derived from the same real
 * operations-log data via groupStages, instead of a hand-maintained
 * status-string switch — a strict accuracy improvement for the old keys,
 * not a breaking change.
 */
function pipelineFromStages(operationsLog: Parameters<typeof groupStages>[0], incidentStatus: string) {
    const stages = groupStages(operationsLog);
    const byStep = Object.fromEntries(stages.map((s) => [s.step, s.status])) as Record<string, ReturnType<typeof groupStages>[number]["status"]>;

    // If the whole incident died, a stage still reading "running" (no
    // explicit failed/completed entry — e.g. an unhandled exception thrown
    // before that step logged its own failure) should read as failed rather
    // than spin forever in the UI.
    if (incidentStatus === "FAILED") {
        for (const key of Object.keys(byStep)) {
            if (byStep[key] === "running") byStep[key] = "failed";
        }
    }

    return {
        coordinator: byStep.coordinator ?? "pending",
        classify: byStep.classify ?? "pending",
        diagnose: byStep.diagnose ?? "pending",
        plan: byStep.planning ?? "pending",
        approval: byStep.approval ?? "pending",
        execute: byStep.execute ?? "pending",
        verify: byStep.verify ?? "pending",
    };
}
