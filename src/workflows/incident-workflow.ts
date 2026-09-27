import { incidentStore } from "@/lib/incidents/incident-store";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import {
    candidates,
    get as getRunbook,
    localShellExecutor,
} from "@/src/runbooks";
import type { DiagnosisInput, Executor, RunbookContext } from "@/src/runbooks";
import type { IncidentOperation } from "@/lib/incidents/incident";
import { generateWithFailover } from "@/src/models/with-failover";
import { classifyIncidentWithJev } from "@/src/services/jev-client";
import { tracer } from "@/lib/tracing";
import { SpanStatusCode } from "@opentelemetry/api";

/**
 * Merges runbook telemetry onto the incident record one level deep, so e.g.
 * verify()'s `{ redis: { after: {...} } }` extends execute()'s
 * `{ redis: { before: {...} } }` instead of replacing the whole `redis` key
 * (a plain top-level `{...a, ...b}` spread would silently drop `before`).
 */
function mergeTelemetry(
    current: Record<string, unknown> | undefined,
    incoming: Record<string, unknown>
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
        const existing = merged[key];
        merged[key] =
            existing && typeof existing === "object" && value && typeof value === "object"
                ? { ...(existing as Record<string, unknown>), ...(value as Record<string, unknown>) }
                : value;
    }
    return merged;
}

const diagnosisSchema = z.object({
    rootCause: z.string(),
    severity: z.string(),
    affectedService: z.string(),
    recommendation: z.string(),
});

/**
 * Wraps an executor so every command it runs appears in the operations log
 * the moment it *starts* (as "running") and flips to its terminal state when
 * it finishes — instead of the whole batch being written after the runbook
 * has already returned. Without this, a slow command like `nvm install`
 * leaves the live tail silent for ~12s and then dumps every step at once
 * with identical timestamps.
 */
function withLiveOperationsLog(
    executor: Executor,
    liveLog: { incidentId: string; step: IncidentOperation["step"] }
): Executor {
    return {
        async run(command, opts) {
            const startedAt = Date.now();
            const entry = incidentStore.addOperation({
                incidentId: liveLog.incidentId,
                step: liveLog.step,
                title: opts?.label ?? command,
                status: "running",
                timestamp: startedAt,
            });

            const result = await executor.run(command, opts);

            if (entry) {
                incidentStore.updateOperation(liveLog.incidentId, entry.id, {
                    status: result.ok ? "completed" : "failed",
                    details: result.stdout?.trim() || result.stderr?.trim() || undefined,
                    duration: Date.now() - startedAt,
                });
            }

            return result;
        },
    };
}

function buildRunbookContext(
    mastra: {
        getAgent(id: string): { generate: (prompt: string, opts?: unknown) => Promise<{ text: string }> };
    },
    liveLog?: { incidentId: string; step: IncidentOperation["step"] }
): RunbookContext {
    return {
        executor: liveLog ? withLiveOperationsLog(localShellExecutor, liveLog) : localShellExecutor,
        generate: async (agentId, prompt, opts) => {
            const agent = mastra.getAgent(agentId);
            // If the caller explicitly asked for the fallback model, don't wrap —
            // they're testing the fallback path (e.g. the llm-rate-limit runbook).
            if (opts && typeof opts === "object" && "model" in opts) {
                return agent.generate(prompt, opts);
            }
            const result = await generateWithFailover(agent, prompt, {
                toolChoice: (opts as { toolChoice?: "auto" | "none" } | undefined)?.toolChoice,
            });
            return { text: result.text };
        },
    };
}

const coordinatorStep = createStep({
    id: "coordinator",
    description: "Initialize the incident workflow",
    inputSchema: z.object({
        incidentDescription: z.string(),
        incidentId: z.string().optional(),
        service: z.string().optional(),
    }),
    outputSchema: z.object({
        incidentDescription: z.string(),
        incidentId: z.string(),
        service: z.string(),
    }),
    execute: async ({ inputData }) => {
        return tracer.startActiveSpan("Coordinator", async (span) => {
            const stepStart = Date.now();
            try {
                const incidentId = inputData.incidentId ?? `INC-${Date.now()}`;
                const service = inputData.service ?? "unknown";
                span.setAttribute("incident.id", incidentId);
                span.setAttribute("incident.service", service);

                incidentStore.addOperation({
                    incidentId,
                    step: "coordinator",
                    title: "Coordinator Started",
                    status: "running",
                    timestamp: stepStart,
                });

                // Trace ID is shared by every span in this run (same trace,
                // different span IDs) — capturing it once here, at the first
                // step, is enough to correlate the whole incident with SigNoz.
                const spanContext = span.spanContext();
                incidentStore.update(incidentId, {
                    status: "TRIAGING",
                    trace: { traceId: spanContext.traceId, spanId: spanContext.spanId },
                });

                incidentStore.addOperation({
                    incidentId,
                    step: "coordinator",
                    title: "Coordinator Ready",
                    status: "completed",
                    timestamp: Date.now(),
                    duration: Date.now() - stepStart,
                });

                return {
                    incidentDescription: inputData.incidentDescription,
                    incidentId,
                    service,
                };
            } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
            } finally {
                span.end();
            }
        });
    },
});

const classifyStep = createStep({
    id: "classify",
    description: "Classify raw incident into a standard category before diagnosis.",
    inputSchema: z.object({
        incidentDescription: z.string(),
        incidentId: z.string(),
        service: z.string(),
    }),
    outputSchema: z.object({
        incidentDescription: z.string(),
        incidentId: z.string(),
        service: z.string(),
        category: z.string(),
        classifierService: z.string(),
        classifierConfidence: z.number(),
    }),
    execute: async ({ inputData, mastra }) => {
        return tracer.startActiveSpan("Classify Incident", async (span) => {
            const stepStart = Date.now();
            try {
                span.setAttribute("incident.id", inputData.incidentId);
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "classify",
                    title: "Classifying Incident",
                    status: "running",
                    timestamp: stepStart,
                })

                let category = "unknown";
                let classifierService = inputData.service || "unknown";
                let classifierConfidence = 0;

                // Fast path: a typed Jev Choice call replaces the old free-form LLM
                // completion + regex/fence-stripped JSON parse below. Same category
                // vocabulary (see src/services/jev-client.ts), a real probability
                // distribution instead of a self-reported confidence number, and no
                // JSON to fail to parse.
                const jevResult = await classifyIncidentWithJev(inputData.incidentDescription);

                if (jevResult) {
                    category = jevResult.category;
                    classifierService = jevResult.service;
                    classifierConfidence = jevResult.confidence;
                    span.setAttribute("classifier.source", "jev");
                } else {
                    span.setAttribute("classifier.source", "llm-fallback");
                    const agent = mastra.getAgent("classifierAgent");
                    const result = await generateWithFailover(
                        agent,
                        `Classify this incident. Return raw JSON only with keys category, service, confidence.\n\n${inputData.incidentDescription}`
                    );
                    span.setAttribute("llm.provider", result.provider);

                    const cleaned = result.text
                        .trim()
                        .replace(/^```(?:json)?\s*/i, "")
                        .replace(/```$/i, "")
                        .trim();
                    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            const parsed = JSON.parse(jsonMatch[0]);
                            if (typeof parsed.category === "string") category = parsed.category;
                            if (typeof parsed.service === "string") classifierService = parsed.service;
                            if (typeof parsed.confidence === "number") classifierConfidence = parsed.confidence;
                        } catch {
                            // stay with defaults
                        }
                    }
                }

                span.setAttribute("classifier.category", category);
                span.setAttribute("classifier.service", classifierService);
                span.setAttribute("classifier.confidence", classifierConfidence);

                incidentStore.update(inputData.incidentId, {
                    category,
                    classifierService,
                    classifierConfidence,
                });
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "classify",
                    title: `Category: ${category}`,
                    status: "completed",
                    timestamp: Date.now(),
                    duration: Date.now() - stepStart,
                });

                return {
                    incidentDescription: inputData.incidentDescription,
                    incidentId: inputData.incidentId,
                    service: inputData.service,
                    category,
                    classifierService,
                    classifierConfidence,
                };
            } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
            } finally {
                span.end();
            }
        });
    },
});

const diagnoseStep = createStep({
    id: "diagnose",
    description: "Analyze the incident to determine root cause",
    inputSchema: z.object({
        incidentDescription: z.string(),
        incidentId: z.string(),
        service: z.string(),
        category: z.string(),
        classifierService: z.string(),
        classifierConfidence: z.number(),
    }),
    outputSchema: z.object({
        incidentId: z.string(),
        rootCause: z.string(),
        severity: z.string(),
        confidence: z.number(),
        affectedService: z.string(),
        recommendation: z.string(),
        category: z.string(),
    }),
    execute: async ({ inputData, mastra }) => {
        return tracer.startActiveSpan("Diagnose Incident", async (span) => {
            const stepStart = Date.now();
            try {
                span.setAttribute("incident.id", inputData.incidentId);
                span.setAttribute("classifier.category", inputData.category);

                const agent = mastra.getAgent("diagnosisAgent");
                const enriched = `Classifier hint (confidence ${inputData.classifierConfidence.toFixed(2)}): category=${inputData.category}, service=${inputData.classifierService}.

Incident:
${inputData.incidentDescription}`;
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "diagnose",
                    title: "Diagnosis Agent Running",
                    status: "running",
                    timestamp: stepStart,
                });
                const result = await generateWithFailover(
                    agent,
                    `Analyze this incident and return JSON with rootCause, severity, confidence, affectedService, and recommendation:\n\n${enriched}`
                );
                span.setAttribute("llm.provider", result.provider);
                if (result.provider === "fallback") {
                    console.log(`[diagnose] served via Ollama fallback (attempts: ${result.attempts})`);
                }

                // Strip common markdown wrappers before JSON parsing — small models often add ```json fences.
                const cleaned = result.text
                    .trim()
                    .replace(/^```(?:json)?\s*/i, "")
                    .replace(/```$/i, "")
                    .trim();
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

                if (jsonMatch) {
                    try {
                        const parsed = JSON.parse(jsonMatch[0]);
                        span.setAttribute("diagnosis.severity", parsed.severity ?? "unknown");
                        span.setAttribute("diagnosis.confidence", parsed.confidence ?? 0);
                        span.setAttribute("diagnosis.affected_service", parsed.affectedService ?? "unknown");
                        incidentStore.update(inputData.incidentId, {
                            severity: parsed.severity,
                            rootCause: parsed.rootCause,
                            affectedService: parsed.affectedService,
                            recommendation: parsed.recommendation,
                            status: "DIAGNOSING",
                        });
                        incidentStore.addOperation({
                            incidentId: inputData.incidentId,
                            step: "diagnose",
                            title: `Root Cause Identified: ${parsed.severity ?? "unknown"}`,
                            status: "completed",
                            timestamp: Date.now(),
                            duration: Date.now() - stepStart,
                        });
                        return {
                            ...parsed,
                            incidentId: inputData.incidentId,
                            category: inputData.category,
                        };
                    } catch {
                        // Fall through to unstructured handling
                    }
                }

                span.setAttribute("diagnosis.severity", "unknown");
                span.addEvent("diagnosis.unstructured_response");
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "diagnose",
                    title: "Diagnosis Returned Unstructured Response",
                    status: "completed",
                    timestamp: Date.now(),
                    duration: Date.now() - stepStart,
                });
                return {
                    incidentId: inputData.incidentId,
                    rootCause: result.text,
                    severity: "unknown",
                    confidence: 0.5,
                    affectedService: inputData.classifierService || inputData.service || "unknown",
                    recommendation: "Manual investigation needed",
                    category: inputData.category,
                };
            } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
            } finally {
                span.end();
            }
        });
    },
});

const planStep = createStep({
    id: "plan-remediation",
    description: "Select a runbook based on the diagnosis and generate a human-readable plan.",
    inputSchema: z.object({
        incidentId: z.string(),
        rootCause: z.string(),
        severity: z.string(),
        confidence: z.number(),
        affectedService: z.string(),
        recommendation: z.string(),
        category: z.string(),
    }),
    outputSchema: z.object({
        incidentId: z.string(),
        plan: z.string(),
        runbookId: z.string().nullable(),
        riskTier: z.string(),
        diagnosis: diagnosisSchema,
    }),
    execute: async ({ inputData, mastra }) => {
        return tracer.startActiveSpan("Plan Remediation", async (span) => {
            const stepStart = Date.now();
            try {
                span.setAttribute("incident.id", inputData.incidentId);
                incidentStore.update(inputData.incidentId, { status: "PLANNING" });

                const diagnosis: DiagnosisInput = {
                    rootCause: inputData.rootCause,
                    severity: inputData.severity,
                    affectedService: inputData.affectedService,
                    recommendation: inputData.recommendation,
                    category: inputData.category,
                };

                const matches = candidates(diagnosis);
                const chosen = matches[0];
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "planning",
                    title: "Selecting Runbook",
                    status: "running",
                    timestamp: stepStart,
                })
                span.setAttribute("runbook.candidates_count", matches.length);

                if (!chosen) {
                    span.setAttribute("runbook.id", "none");
                    span.addEvent("plan.no_runbook_matched");
                    incidentStore.addOperation({
                        incidentId: inputData.incidentId,
                        step: "planning",
                        title: "No Matching Runbook",
                        status: "failed",
                        timestamp: Date.now(),
                        duration: Date.now() - stepStart,
                    });
                    return {
                        incidentId: inputData.incidentId,
                        plan: "No matching runbook found. Escalating to human review.",
                        runbookId: null,
                        riskTier: "unknown",
                        diagnosis,
                    };
                }
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "planning",
                    title: `Runbook Selected: ${chosen.runbook.id}`,
                    status: "completed",
                    timestamp: Date.now(),
                    duration: Date.now() - stepStart,
                });

                span.setAttribute("runbook.id", chosen.runbook.id);
                span.setAttribute("runbook.risk_tier", chosen.runbook.riskTier);
                span.setAttribute("runbook.match_confidence", chosen.confidence);

                let plan = `Runbook selected: ${chosen.runbook.id} (${chosen.reason}). ${chosen.runbook.description}`;
                try {
                    const agent = mastra.getAgent("planningAgent");
                    const narrative = await generateWithFailover(
                        agent,
                        `The selected remediation is "${chosen.runbook.id}": ${chosen.runbook.description}
Diagnosis root cause: ${inputData.rootCause}
Affected service: ${inputData.affectedService}

Write a 2-3 sentence plain-English summary of what will happen. Do not include shell commands.`
                    );
                    const trimmed = narrative.text.trim();
                    if (trimmed) plan = trimmed;
                } catch {
                    // Narrative is nice-to-have — runbook selection is what matters.
                    span.addEvent("plan.narrative_generation_failed");
                }

                incidentStore.update(inputData.incidentId, { plan });

                return {
                    incidentId: inputData.incidentId,
                    plan,
                    runbookId: chosen.runbook.id,
                    riskTier: chosen.runbook.riskTier,
                    diagnosis,
                };
            } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
            } finally {
                span.end();
            }
        });
    },
});

/** Risk tiers that execute autonomously without a human gate. Everything else suspends for approval. */
const AUTO_APPROVE_RISK_TIERS = new Set(["low"]);

const decisionGateStep = createStep({
    id: "decision-gate",
    description: "Gate execution on risk tier — auto-approve low risk, suspend for human approval otherwise.",
    inputSchema: z.object({
        incidentId: z.string(),
        plan: z.string(),
        runbookId: z.string().nullable(),
        riskTier: z.string(),
        diagnosis: diagnosisSchema,
    }),
    resumeSchema: z.object({
        approved: z.boolean(),
        approver: z.string().optional(),
        reason: z.string().optional(),
    }),
    suspendSchema: z.object({
        reason: z.string(),
        runbookId: z.string(),
        riskTier: z.string(),
        plan: z.string(),
    }),
    outputSchema: z.object({
        incidentId: z.string(),
        plan: z.string(),
        runbookId: z.string().nullable(),
        riskTier: z.string(),
        approved: z.boolean(),
        diagnosis: diagnosisSchema,
    }),
    execute: async ({ inputData, resumeData, suspend }) => {
        // Deliberately NOT using startActiveSpan/a wrapping try-finally here.
        // suspend() can pause this step for an arbitrary (human-scale) amount
        // of time — a span must not stay open across that wait. Instead we
        // create a short-lived span per invocation (once when suspending,
        // once again on resume — execute() re-runs from the top), always
        // ending it BEFORE calling suspend(), so it never wraps the wait.
        const span = tracer.startSpan("Decision Gate");
        span.setAttribute("incident.id", inputData.incidentId);
        span.setAttribute("runbook.id", inputData.runbookId ?? "none");
        span.setAttribute("risk.tier", inputData.riskTier);

        if (!inputData.runbookId) {
            span.setAttribute("decision.outcome", "no_runbook");
            span.end();
            return { ...inputData, approved: false };
        }

        if (resumeData) {
            span.setAttribute("decision.outcome", resumeData.approved ? "approved_by_human" : "rejected_by_human");
            span.setAttribute("decision.approved", resumeData.approved);
            if (resumeData.approver) span.setAttribute("decision.approver", resumeData.approver);
            span.end();

            // Duration here is genuine human-decision latency: how long the
            // incident actually sat waiting, not this function invocation's
            // own (near-instant) run time. Found by locating the "waiting"
            // entry this same step logged when it first suspended.
            const incident = incidentStore.get(inputData.incidentId);
            const waitingEntry = incident?.operationsLog
                ?.filter((op) => op.step === "approval" && op.status === "waiting")
                .at(-1);
            const waitDuration = waitingEntry ? Date.now() - waitingEntry.timestamp : undefined;

            incidentStore.addOperation({
                incidentId: inputData.incidentId,
                step: "approval",
                title: resumeData.approved ? "Approved" : "Rejected",
                status: "completed",
                timestamp: Date.now(),
                duration: waitDuration,
                details: resumeData.reason,
            });

            return { ...inputData, approved: resumeData.approved };
        }

        if (AUTO_APPROVE_RISK_TIERS.has(inputData.riskTier)) {
            span.setAttribute("decision.outcome", "auto_approved");
            span.end();
            incidentStore.addOperation({
                incidentId: inputData.incidentId,
                step: "approval",
                title: "Auto-Approved (Low Risk)",
                status: "completed",
                timestamp: Date.now(),
                duration: 0,
            });
            return { ...inputData, approved: true };
        }

        const reason = `Runbook "${inputData.runbookId}" has risk tier "${inputData.riskTier}" and requires human approval before executing.`;

        span.setAttribute("decision.outcome", "suspended_for_approval");
        span.addEvent("decision_gate.suspended");
        span.end();
        incidentStore.addOperation({
            incidentId: inputData.incidentId,
            step: "approval",
            title: "Waiting For Human Approval",
            status: "waiting",
            timestamp: Date.now(),
        });

        incidentStore.update(inputData.incidentId, {
            status: "AWAITING_APPROVAL",
            runbookId: inputData.runbookId,
            riskTier: inputData.riskTier,
            approvalReason: reason,
        });

        return await suspend({
            reason,
            runbookId: inputData.runbookId,
            riskTier: inputData.riskTier,
            plan: inputData.plan,
        });
    },
});

const executeStep = createStep({
    id: "execute-remediation",
    description: "Execute the selected runbook.",
    inputSchema: z.object({
        incidentId: z.string(),
        plan: z.string(),
        runbookId: z.string().nullable(),
        riskTier: z.string(),
        approved: z.boolean(),
        diagnosis: diagnosisSchema,
    }),
    outputSchema: z.object({
        incidentId: z.string(),
        overallStatus: z.string(),
        summary: z.string(),
        executedSteps: z.array(z.string()),
        runbookId: z.string().nullable(),
        diagnosis: diagnosisSchema,
    }),
    execute: async ({ inputData, mastra }) => {
        return tracer.startActiveSpan("Execute Remediation", async (span) => {
            const stepStart = Date.now();
            try {
                span.setAttribute("incident.id", inputData.incidentId);
                span.setAttribute("runbook.id", inputData.runbookId ?? "none");
                span.setAttribute("decision.approved", inputData.approved);

                if (!inputData.approved || !inputData.runbookId) {
                    span.setAttribute("execution.status", "blocked");
                    incidentStore.addOperation({
                        incidentId: inputData.incidentId,
                        step: "execute",
                        title: "Execution Blocked",
                        status: "failed",
                        timestamp: Date.now(),
                        duration: Date.now() - stepStart,
                        details: "No matching runbook or plan not approved",
                    });
                    incidentStore.update(inputData.incidentId, {
                        status: "AWAITING_REVIEW",
                    });
                    return {
                        incidentId: inputData.incidentId,
                        overallStatus: "blocked",
                        summary: "No matching runbook or plan not approved — escalated to human review.",
                        executedSteps: [],
                        runbookId: inputData.runbookId,
                        diagnosis: inputData.diagnosis,
                    };
                }

                const runbook = getRunbook(inputData.runbookId);
                if (!runbook) {
                    span.setAttribute("execution.status", "failed");
                    span.setStatus({ code: SpanStatusCode.ERROR, message: "Runbook not found" });
                    incidentStore.addOperation({
                        incidentId: inputData.incidentId,
                        step: "execute",
                        title: `Runbook Not Found: ${inputData.runbookId}`,
                        status: "failed",
                        timestamp: Date.now(),
                        duration: Date.now() - stepStart,
                    });
                    incidentStore.update(inputData.incidentId, {
                        status: "FAILED",
                        failureReason: `Runbook not found: ${inputData.runbookId}`,
                    });
                    return {
                        incidentId: inputData.incidentId,
                        overallStatus: "failed",
                        summary: `Runbook not found in registry: ${inputData.runbookId}`,
                        executedSteps: [],
                        runbookId: inputData.runbookId,
                        diagnosis: inputData.diagnosis,
                    };
                }

                incidentStore.update(inputData.incidentId, { status: "EXECUTING" });
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "execute",
                    title: `Executing Runbook: ${inputData.runbookId}`,
                    status: "running",
                    timestamp: stepStart,
                });

                const ctx = buildRunbookContext(mastra, {
                    incidentId: inputData.incidentId,
                    step: "execute",
                });
                const result = await runbook.execute(inputData.diagnosis, ctx);
                span.setAttribute("execution.status", result.status);
                span.setAttribute("execution.step_count", result.steps.length);

                if (result.telemetry) {
                    const current = incidentStore.get(inputData.incidentId);
                    incidentStore.update(inputData.incidentId, {
                        telemetry: mergeTelemetry(current?.telemetry, result.telemetry),
                    });
                }

                const executedSteps = result.steps.map((s) => {
                    const tag = s.result.ok ? "OK" : "FAIL";
                    const detail = s.result.stdout?.trim() || s.result.stderr?.trim() || "";
                    return detail
                        ? `[${tag}] ${s.command} → ${detail.slice(0, 120)}`
                        : `[${tag}] ${s.command}`;
                });

                // Individual commands are already in the operations log —
                // the executor streams each one live as it runs (see
                // withLiveOperationsLog), so re-logging result.steps here
                // would just duplicate them after the fact.

                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "execute",
                    title: result.status === "success" ? "Execution Complete" : "Execution Failed",
                    status: result.status === "success" ? "completed" : "failed",
                    timestamp: Date.now(),
                    duration: Date.now() - stepStart,
                });

                return {
                    incidentId: inputData.incidentId,
                    overallStatus: result.status,
                    summary: result.summary,
                    executedSteps,
                    runbookId: inputData.runbookId,
                    diagnosis: inputData.diagnosis,
                };
            } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
            } finally {
                span.end();
            }
        });
    },
});

const verifyStep = createStep({
    id: "verify-remediation",
    description: "Verify remediation using the runbook's verify() method.",
    inputSchema: z.object({
        incidentId: z.string(),
        overallStatus: z.string(),
        summary: z.string(),
        executedSteps: z.array(z.string()),
        runbookId: z.string().nullable(),
        diagnosis: diagnosisSchema,
    }),
    outputSchema: z.object({
        resolved: z.boolean(),
        recommendation: z.string(),
        evidence: z.array(z.string()),
    }),
    execute: async ({ inputData, mastra }) => {
        return tracer.startActiveSpan("Verify Remediation", async (span) => {
            const stepStart = Date.now();
            try {
                span.setAttribute("incident.id", inputData.incidentId);
                span.setAttribute("runbook.id", inputData.runbookId ?? "none");

                if (inputData.overallStatus === "blocked" || !inputData.runbookId) {
                    span.setAttribute("verify.resolved", false);
                    incidentStore.addOperation({
                        incidentId: inputData.incidentId,
                        step: "verify",
                        title: "Verification Skipped",
                        status: "failed",
                        timestamp: Date.now(),
                        duration: Date.now() - stepStart,
                        details: "Remediation was not attempted (no runbook or not approved)",
                    });
                    incidentStore.update(inputData.incidentId, { status: "FAILED" });
                    return {
                        resolved: false,
                        recommendation: "escalate",
                        evidence: ["Remediation was not attempted (no runbook or not approved)"],
                    };
                }

                const runbook = getRunbook(inputData.runbookId);
                if (!runbook) {
                    span.setAttribute("verify.resolved", false);
                    span.setStatus({ code: SpanStatusCode.ERROR, message: "Runbook not found" });
                    incidentStore.update(inputData.incidentId, { status: "FAILED" });
                    return {
                        resolved: false,
                        recommendation: "escalate",
                        evidence: [`Runbook not found in registry: ${inputData.runbookId}`],
                    };
                }

                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "verify",
                    title: "Verifying Remediation",
                    status: "running",
                    timestamp: stepStart,
                });

                console.log(`[verify] Waiting 8s before running ${inputData.runbookId}.verify()...`);
                span.addEvent("verify.propagation_wait_start");
                await new Promise((resolve) => setTimeout(resolve, 8000));
                span.addEvent("verify.propagation_wait_end");

                const ctx = buildRunbookContext(mastra);
                const result = await runbook.verify(inputData.diagnosis, ctx);
                span.setAttribute("verify.resolved", result.resolved);

                const verifyDuration = Date.now() - stepStart;
                incidentStore.addOperation({
                    incidentId: inputData.incidentId,
                    step: "verify",
                    title: result.resolved ? "Verification Passed" : "Verification Failed",
                    status: result.resolved ? "completed" : "failed",
                    timestamp: Date.now(),
                    duration: verifyDuration,
                    details: result.evidence.join("; "),
                });

                const mergedTelemetry = result.telemetry
                    ? mergeTelemetry(incidentStore.get(inputData.incidentId)?.telemetry, result.telemetry)
                    : undefined;

                if (result.resolved) {
                    incidentStore.update(inputData.incidentId, {
                        status: "RESOLVED",
                        resolvedAt: Date.now(),
                        ...(mergedTelemetry && { telemetry: mergedTelemetry }),
                    });
                    return {
                        resolved: true,
                        recommendation: "close_incident",
                        evidence: result.evidence,
                    };
                }

                incidentStore.update(inputData.incidentId, {
                    status: "AWAITING_REVIEW",
                    ...(mergedTelemetry && { telemetry: mergedTelemetry }),
                });
                return {
                    resolved: false,
                    recommendation: "escalate",
                    evidence: result.evidence,
                };
            } catch (err) {
                span.recordException(err as Error);
                span.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
            } finally {
                span.end();
            }
        });
    },
});

export const incidentWorkflow = createWorkflow({
    id: "incident-workflow",
    description: "End-to-end incident response: diagnose → select runbook → execute → verify",
    inputSchema: z.object({
        incidentDescription: z.string(),
        incidentId: z.string().optional(),
        service: z.string().optional(),
    }),
    outputSchema: z.object({
        resolved: z.boolean(),
        recommendation: z.string(),
        evidence: z.array(z.string()),
    }),
})
    .then(coordinatorStep)
    .then(classifyStep)
    .then(diagnoseStep)
    .then(planStep)
    .then(decisionGateStep)
    .then(executeStep)
    .then(verifyStep)
    .commit();
