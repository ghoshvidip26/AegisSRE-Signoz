import { createTool } from "@mastra/core/tools";
import { z } from 'zod';

/**
 * Validates remediation plans against safety policies using the Enkrypt AI Guardrails API.
 * Uses the /guardrails/detect endpoint with policy_violation detector.
 * 
 * API docs: https://docs.enkryptai.com/api-reference/guardrails-api-reference/endpoint/detect
 */
export const enkryptPolicyTool = createTool({
    id: 'enkrypt-policy-validator',
    description: 'Validates an AI-generated remediation plan using Enkrypt AI Guardrails. Checks for policy violations, injection attacks, and unsafe content.',
    inputSchema: z.object({
        remediationPlan: z.string().describe("The full remediation plan text to validate"),
    }),
    execute: async (inputData) => {
        const apiKey = process.env.ENKRYPT_API_KEY;
        const baseUrl = process.env.ENKRYPT_BASE_URL ?? 'https://api.enkryptai.com';

        if (!apiKey) {
            return {
                allowed: true,
                risk: "unknown",
                reason: "Enkrypt API key not configured — skipping policy validation",
                confidence: 0,
                policyViolation: false,
                injectionDetected: false,
            };
        }

        try {
            const response = await fetch(`${baseUrl}/guardrails/detect`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "apikey": apiKey,
                },
                body: JSON.stringify({
                    text: inputData.remediationPlan,
                    detectors: {
                        policy_violation: {
                            enabled: true,
                            policy_text: `You are validating production remediation commands for an SRE system.

BLOCK if the plan contains:
- Deleting production resources or databases
- DROP DATABASE or DROP TABLE commands
- rm -rf on production paths
- terraform destroy
- kubectl delete namespace on production
- Any command that permanently destroys data
- Disabling security controls or authentication

ALLOW if the plan contains:
- kubectl rollout restart
- kubectl scale
- kubectl logs or kubectl describe
- Service restarts (systemctl restart, docker restart)
- Redis FLUSHDB on non-production
- Scaling up/down replicas
- Configuration changes with rollback capability
- Health checks and monitoring commands`,
                            need_explanation: true,
                        },
                        injection_attack: {
                            enabled: true,
                        },
                        toxicity: {
                            enabled: false,
                        },
                    },
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[enkrypt] API error (${response.status}): ${errorText}`);
                // Don't block on API errors — allow with warning
                return {
                    allowed: true,
                    risk: "unknown",
                    reason: `Enkrypt API returned ${response.status} — plan allowed with warning`,
                    confidence: 0,
                    policyViolation: false,
                    injectionDetected: false,
                };
            }

            const result = await response.json();

            const policyViolation = result.summary?.policy_violation === 1;
            const injectionDetected = result.summary?.injection_attack === 1;
            const violationDetails = result.details?.policy_violation;
            const injectionDetails = result.details?.injection_attack;

            const allowed = !policyViolation && !injectionDetected;
            const confidence = injectionDetails?.attack ?? 0;

            let risk = "low";
            if (policyViolation && injectionDetected) risk = "critical";
            else if (policyViolation) risk = "high";
            else if (injectionDetected) risk = "high";
            else if (confidence > 0.3) risk = "medium";

            return {
                allowed,
                risk,
                reason: policyViolation
                    ? `Policy violation: ${violationDetails?.violating_policy ?? 'Unknown policy'} — ${violationDetails?.explanation ?? 'No explanation'}`
                    : injectionDetected
                        ? "Injection attack detected in remediation plan"
                        : "Plan passed all safety checks",
                confidence: allowed ? 1 - confidence : confidence,
                policyViolation,
                injectionDetected,
            };
        } catch (error) {
            console.error("[enkrypt] Request failed:", error);
            // Network errors shouldn't block remediation
            return {
                allowed: true,
                risk: "unknown",
                reason: `Enkrypt API unreachable — plan allowed with warning: ${error instanceof Error ? error.message : 'unknown'}`,
                confidence: 0,
                policyViolation: false,
                injectionDetected: false,
            };
        }
    }
})
