import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { incidentStore } from "@/lib/incidents/incident-store";
import { mastra } from '@/src/mastra';
import { withRetry, isRateLimitError } from "@/lib/utils/retry";
import { fallbackModel } from "@/src/models/fallback";
import { tracer } from '@/lib/tracing'
import { SpanStatusCode } from '@opentelemetry/api'
import { recordRequest } from '@/app/lib/telemetry/instruments'
import { checkApiKey } from '@/lib/auth'

const runtimeInfoSchema = z.object({
    nodeVersion: z.string().optional(),
    platform: z.string().optional(),
    pid: z.number().optional(),
    hostname: z.string().optional(),
});

const incidentPayloadSchema = z.object({
    // Required (from SDK)
    service: z.string().trim().min(1, "service is required"),
    message: z.string().trim().min(1, "message is required"),
    // Optional (from SDK)
    stack: z.string().optional(),
    runtime: runtimeInfoSchema.optional(),
    environment: z.string().optional(),
    timestamp: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    // Legacy fields kept for backward compat (chat trigger, curl callers). Runtime
    // is authoritative — anything here is treated as a hint, not a decision.
    title: z.string().optional(),
    severity: z.enum(["P1", "P2", "P3", "P4"]).optional(),
    logs: z
        .array(
            z.object({
                timestamp: z.string(),
                level: z.enum(["INFO", "WARN", "ERROR"]),
                message: z.string(),
            })
        )
        .optional(),
});

/** First line of the message, capped at 80 chars — used for UI display until the Runtime sets a proper title. */
function deriveTitle(message: string): string {
    const firstLine = message.split("\n")[0] ?? message;
    return firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
}

/** Build the incidentDescription string passed into the workflow. Includes SDK-provided context so agents have more to reason over. */
function buildIncidentDescription(incident: {
    service: string;
    title?: string;
    message: string;
    stack?: string;
    runtime?: z.infer<typeof runtimeInfoSchema>;
    environment?: string;
    metadata?: Record<string, unknown>;
}): string {
    const parts: string[] = [`Service: ${incident.service}`];
    if (incident.title) parts.push(`Title: ${incident.title}`);
    parts.push(`Message: ${incident.message}`);
    if (incident.environment) parts.push(`Environment: ${incident.environment}`);
    if (incident.stack) parts.push(`Stack trace:\n${incident.stack}`);
    if (incident.runtime && Object.keys(incident.runtime).length > 0) {
        parts.push(`Runtime: ${JSON.stringify(incident.runtime)}`);
    }
    if (incident.metadata && Object.keys(incident.metadata).length > 0) {
        parts.push(`Metadata: ${JSON.stringify(incident.metadata)}`);
    }
    return parts.join("\n\n");
}

/**
 * Infer severity from incident content when not explicitly provided.
 * Uses keyword matching on the title and message to assign a priority level.
 */
function inferSeverity(incident: { title?: string; message?: string; service?: string }): "P1" | "P2" | "P3" | "P4" {
    const text = `${incident.title ?? ''} ${incident.message ?? ''}`.toLowerCase();

    // P1: Complete outage / connection failures / data loss
    if (
        text.includes('connection refused') ||
        text.includes('connection failed') ||
        text.includes('outage') ||
        text.includes('down') ||
        text.includes('unreachable') ||
        text.includes('data loss') ||
        text.includes('crash')
    ) {
        return 'P1';
    }

    // P2: Degraded performance / elevated errors
    if (
        text.includes('timeout') ||
        text.includes('error rate') ||
        text.includes('degraded') ||
        text.includes('high latency') ||
        text.includes('memory leak') ||
        text.includes('pool exhausted')
    ) {
        return 'P2';
    }

    // P3: Warnings / non-critical issues
    if (
        text.includes('warning') ||
        text.includes('retry') ||
        text.includes('slow') ||
        text.includes('disk space')
    ) {
        return 'P3';
    }

    // P4: Informational / low impact
    return 'P4';
}

export async function POST(req: NextRequest) {
    // No-op unless AEGIS_API_KEY is set — see lib/auth.ts.
    const auth = checkApiKey(req);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let rawBody: unknown;
    try {
        rawBody = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 }
        );
    }

    const start = performance.now();
    return tracer.startActiveSpan("Create Incident", async (span) => {
        let isError = false;
        try {
            const parsed = incidentPayloadSchema.safeParse(rawBody);
            if (!parsed.success) {
                isError = true;
                span.setStatus({ code: SpanStatusCode.ERROR, message: "Invalid incident payload" });
                return NextResponse.json(
                    {
                        error: "Invalid incident payload",
                        issues: parsed.error.issues.map((i) => ({
                            path: i.path.join("."),
                            message: i.message,
                        })),
                    },
                    { status: 400 }
                );
            }

            const incident = parsed.data;
            span.setAttribute("incident.message", incident.message);
            span.setAttribute("incident.service", incident.service);

            const createdIncident = incidentStore.create({
                service: incident.service,
                message: incident.message,
                title: incident.title ?? deriveTitle(incident.message),
                severity: incident.severity ?? inferSeverity(incident),
                stack: incident.stack,
                runtime: incident.runtime,
                environment: incident.environment,
                metadata: incident.metadata,
                timestamp: incident.timestamp,
                logs: incident.logs ?? [],
                status: "OPEN",
            });
            span.setAttribute("incident.id", createdIncident.id);
            span.setAttribute("incident.severity", createdIncident.severity ?? "unknown");

            // Fire off the agent processing with retry — don't block the response.
            // Not awaited, but invoked synchronously within this span's active
            // context, so the nested workflow spans it starts (see
            // processIncidentAsync) are correctly attached as descendants of
            // this span even though we return — and end this span — first.
            processIncidentAsync(createdIncident.id, createdIncident);

            return NextResponse.json({
                success: true,
                incident: createdIncident,
            });
        } catch (err) {
            isError = true;
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
        } finally {
            span.end();
            recordRequest("POST /api/incidents", performance.now() - start, isError);
        }
    })
}

/**
 * Process the incident asynchronously with retry logic.
 * If primary model rate-limits, falls back to local Ollama.
 * If everything fails, marks the incident as FAILED with a reason.
 */
async function processIncidentAsync(
    incidentId: string,
    incident: {
        id: string;
        service: string;
        severity?: string;
        title?: string;
        message: string;
        stack?: string;
        runtime?: z.infer<typeof runtimeInfoSchema>;
        environment?: string;
        metadata?: Record<string, unknown>;
    }
) {
    return tracer.startActiveSpan("Process Incident Workflow", async (span) => {
        span.setAttribute("incident.id", incidentId);
        span.setAttribute("incident.service", incident.service);

        const workflow = mastra.getWorkflow("incidentWorkflow");

        const workflowInput = {
            incidentDescription: buildIncidentDescription(incident),
            incidentId: incident.id,
            service: incident.service,
        };

        try {
            // Try primary model with retries
            const { attempts } = await withRetry(
                async () => {
                    const run = await workflow.createRun();
                    span.setAttribute("workflow.run_id", run.runId);
                    incidentStore.update(incidentId, { pendingRunId: run.runId });

                    const result = await run.start({ inputData: workflowInput });

                    if (result.status === 'suspended') {
                        // Decision Gateway paused for human approval — not a failure, don't retry.
                        span.setAttribute("workflow.status", "suspended");
                        span.addEvent("workflow.suspended", { "workflow.run_id": run.runId });
                        console.log(`[incident] ${incidentId} suspended — awaiting approval (runId: ${run.runId})`);
                        return result;
                    }

                    if (result.status === 'failed') {
                        // Find which step failed
                        const failedStepId = findFailedStep(result);
                        const errorMsg = result.error?.message || "Workflow failed";
                        span.setAttribute("workflow.status", "failed");
                        span.setAttribute("workflow.failed_step", failedStepId);
                        console.error(`[incident] ${incidentId} workflow failed at step: ${failedStepId}`, errorMsg);

                        incidentStore.update(incidentId, {
                            status: "FAILED",
                            failedStep: failedStepId,
                            failureReason: errorMsg,
                        });
                        throw new Error(errorMsg);
                    }
                    span.setAttribute("workflow.status", "success");
                    return result;
                },
                {
                    maxAttempts: 2,
                    initialDelay: 2000,
                    backoffMultiplier: 2,
                    maxDelay: 10000,
                }
            );

            span.setAttribute("workflow.retry_attempts", attempts);
            if (attempts > 1) {
                console.log(`[incident] ${incidentId} processed after ${attempts} attempts on primary model`);
            }

            incidentStore.update(incidentId, { retryCount: attempts });
        } catch (primaryError) {
            span.recordException(primaryError as Error);

            // If rate-limited, fall back to local Ollama (gemma3:1b) in tool-free mode
            if (isRateLimitError(primaryError)) {
                span.addEvent("workflow.fallback_to_ollama");
                console.log(`[incident] ${incidentId} primary model rate-limited. Falling back to Ollama (gemma3:1b, tool-free)...`);

                try {
                    // gemma3:1b doesn't support tool calling, so we use toolChoice: "none"
                    // and do a direct text-based triage instead of the full agent workflow
                    const diagnosisAgent = mastra.getAgent("diagnosisAgent");
                    const result = await diagnosisAgent.generate(
                        `You are a senior SRE. Analyze this incident and return ONLY a JSON object with these fields:
- rootCause: string (what caused the incident)
- severity: string (P1/P2/P3/P4)
- confidence: number (0-1)
- affectedService: string
- recommendation: string (immediate action to take)

Incident Title: ${incident.title}
Incident Message: ${incident.message}
Service: ${incident.service}

Return ONLY valid JSON, no markdown, no explanation.`,
                        { model: fallbackModel, toolChoice: "none" }
                    );

                    console.log(`[incident] ${incidentId} processed via tool-free triage (gemma3:1b)`);

                    // Try to parse and update the incident with diagnosis
                    try {
                        const parsed = JSON.parse(result.text);
                        incidentStore.update(incidentId, {
                            status: "DIAGNOSING",
                            retryCount: 3,
                        });
                        console.log(`[incident] ${incidentId} diagnosis: ${JSON.stringify(parsed)}`);
                    } catch {
                        // Even if JSON parse fails, we got a text response — still better than FAILED
                        incidentStore.update(incidentId, {
                            status: "DIAGNOSING",
                            retryCount: 3,
                        });
                        console.log(`[incident] ${incidentId} raw diagnosis: ${result.text}`);
                    }
                } catch (fallbackError) {
                    const reason = `Primary model rate-limited. Fallback (gemma3:1b tool-free) also failed: ${fallbackError instanceof Error ? fallbackError.message : "unknown"}`;
                    console.error(`[incident] ${incidentId} FAILED: ${reason}`);
                    span.recordException(fallbackError as Error);
                    span.setStatus({ code: SpanStatusCode.ERROR, message: reason });

                    incidentStore.update(incidentId, {
                        status: "FAILED",
                        failureReason: reason,
                    });
                }
            } else {
                const reason = primaryError instanceof Error ? primaryError.message : "Unknown error during workflow processing";
                console.error(`[incident] ${incidentId} FAILED: ${reason}`);
                span.setStatus({ code: SpanStatusCode.ERROR, message: reason });

                incidentStore.update(incidentId, {
                    status: "FAILED",
                    failureReason: reason,
                });
            }
        } finally {
            span.end();
        }
    });
}

export async function GET() {
    return NextResponse.json({
        incident: incidentStore.getAll()
    })
}

/**
 * Finds which step failed in a workflow result by checking step statuses.
 */
function findFailedStep(result: { steps?: Record<string, { status?: string }> }): string {
    if (!result.steps) return "unknown";
    for (const [stepId, stepResult] of Object.entries(result.steps)) {
        if (stepResult?.status === 'failed') return stepId;
    }
    return "unknown";
}