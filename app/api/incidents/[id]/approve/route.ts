import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { incidentStore } from "@/lib/incidents/incident-store";
import { mastra } from "@/src/mastra";
import { tracer } from "@/lib/tracing";
import { SpanStatusCode } from "@opentelemetry/api";
import { recordRequest } from "@/app/lib/telemetry/instruments";

const approveSchema = z.object({
    approved: z.boolean(),
    approver: z.string().optional(),
    reason: z.string().optional(),
});

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const start = performance.now();
    return tracer.startActiveSpan("Approve Incident", async (span) => {
        let isError = false;
        try {
            const { id } = await params;
            span.setAttribute("incident.id", id);

            const incident = incidentStore.get(id);
            if (!incident) {
                isError = true;
                span.setStatus({ code: SpanStatusCode.ERROR, message: "Incident not found" });
                return NextResponse.json({ error: "Incident not found" }, { status: 404 });
            }
            span.setAttribute("incident.runbook_id", incident.runbookId ?? "unknown");
            span.setAttribute("incident.risk_tier", incident.riskTier ?? "unknown");

            if (incident.status !== "AWAITING_APPROVAL" || !incident.pendingRunId) {
                isError = true;
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: `Incident not awaiting approval (status: ${incident.status})`,
                });
                return NextResponse.json(
                    { error: `Incident ${id} is not awaiting approval (status: ${incident.status})` },
                    { status: 409 }
                );
            }

            let rawBody: unknown;
            try {
                rawBody = await req.json();
            } catch {
                isError = true;
                span.setStatus({ code: SpanStatusCode.ERROR, message: "Invalid JSON body" });
                return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
            }

            const parsed = approveSchema.safeParse(rawBody);
            if (!parsed.success) {
                isError = true;
                span.setStatus({ code: SpanStatusCode.ERROR, message: "Invalid approval payload" });
                return NextResponse.json(
                    {
                        error: "Invalid approval payload",
                        issues: parsed.error.issues.map((i) => ({
                            path: i.path.join("."),
                            message: i.message,
                        })),
                    },
                    { status: 400 }
                );
            }

            const { approved, approver, reason } = parsed.data;
            span.setAttribute("decision.approved", approved);
            if (approver) span.setAttribute("decision.approver", approver);
            span.setAttribute("workflow.run_id", incident.pendingRunId);

            const workflow = mastra.getWorkflow("incidentWorkflow");

            try {
                const run = await workflow.createRun({ runId: incident.pendingRunId });
                // Awaited within this span's active context — the resumed
                // execute/verify steps nest under this span as their parent.
                const result = await run.resume({
                    resumeData: { approved, approver, reason },
                });
                span.setAttribute("workflow.status", result.status);

                return NextResponse.json({
                    success: true,
                    workflowStatus: result.status,
                    incident: incidentStore.get(id),
                });
            } catch (err) {
                isError = true;
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                const message = err instanceof Error ? err.message : "Failed to resume workflow";
                return NextResponse.json({ error: message }, { status: 500 });
            }
        } finally {
            span.end();
            recordRequest("POST /api/incidents/:id/approve", performance.now() - start, isError);
        }
    });
}
