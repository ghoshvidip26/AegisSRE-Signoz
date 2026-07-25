import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Tool that allows the coordinator agent to delegate incident analysis
 * to the diagnosis agent. This enables multi-agent collaboration where
 * the coordinator routes tasks to specialists.
 */
export const delegateDiagnosisTool = createTool({
    id: "delegate-diagnosis",
    description: "Delegate incident analysis to the Diagnosis Agent. Use this when you have gathered logs and metrics and need a root cause analysis.",
    inputSchema: z.object({
        incidentSummary: z.string().describe("Summary of the incident including symptoms, affected service, and timeline"),
        logs: z.string().describe("Relevant log entries"),
        metrics: z.string().describe("Current metrics snapshot (CPU, memory, error rate, latency)"),
    }),
    execute: async (inputData, context) => {
        const mastra = context?.mastra;
        if (!mastra) {
            return {
                error: "Mastra instance not available for agent delegation",
            };
        }

        const diagnosisAgent = mastra.getAgent("diagnosisAgent");
        const result = await diagnosisAgent.generate(
            `Analyze this incident:

Summary: ${inputData.incidentSummary}

Logs:
${inputData.logs}

Metrics:
${inputData.metrics}

Determine the root cause, severity, confidence, affected service, and immediate recommendation. Return JSON only.`
        );

        return {
            diagnosis: result.text,
        };
    },
});

/**
 * Tool that allows the coordinator to delegate remediation planning
 * to the planning agent after diagnosis is complete.
 */
export const delegatePlanningTool = createTool({
    id: "delegate-planning",
    description: "Delegate remediation planning to the Planning Agent. Use this after diagnosis to generate a safe remediation plan.",
    inputSchema: z.object({
        diagnosis: z.string().describe("The diagnosis output including root cause, severity, and recommendation"),
        affectedService: z.string().describe("The service that needs remediation"),
    }),
    execute: async (inputData, context) => {
        const mastra = context?.mastra;
        if (!mastra) {
            return {
                error: "Mastra instance not available for agent delegation",
            };
        }

        const planningAgent = mastra.getAgent("planningAgent");
        const result = await planningAgent.generate(
            `Generate a remediation plan for this diagnosis. Validate it against safety policies using the Enkrypt Policy Tool before returning.

Diagnosis: ${inputData.diagnosis}
Affected Service: ${inputData.affectedService}

Return a plan with: summary, steps (array of actions), risk level, and whether it's approved by policy.`
        );

        return {
            plan: result.text,
        };
    },
});

/**
 * Tool that allows the coordinator to trigger verification
 * after remediation has been executed.
 */
export const delegateVerificationTool = createTool({
    id: "delegate-verification",
    description: "Delegate post-remediation verification to the Verification Agent. Use after executing a fix to confirm the incident is resolved.",
    inputSchema: z.object({
        remediationSummary: z.string().describe("What was done to remediate the incident"),
        affectedService: z.string().describe("The service that was remediated"),
    }),
    execute: async (inputData, context) => {
        const mastra = context?.mastra;
        if (!mastra) {
            return {
                error: "Mastra instance not available for agent delegation",
            };
        }

        const verificationAgent = mastra.getAgent("verificationAgent");
        const result = await verificationAgent.generate(
            `Verify if this remediation was successful:

Remediation: ${inputData.remediationSummary}
Service: ${inputData.affectedService}

Check current metrics and logs. Determine if the incident is resolved. Return JSON with: resolved (boolean), recommendation (close_incident | escalate | rollback), evidence (array of observations).`
        );

        return {
            verification: result.text,
        };
    },
});
