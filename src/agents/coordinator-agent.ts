import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { logTool } from "../tools/log-tool";
import { metricsTool } from "../tools/metrics-tool";
import { delegateDiagnosisTool, delegatePlanningTool, delegateVerificationTool } from "../tools/delegate-tool";

export const coordinatorAgent = new Agent({
    id: "coordinator-agent",
    name: "Coordinator Agent",
    description: "Main entry point for the Aegis SRE system. Routes user input to specialist agents via delegation tools.",
    instructions: `You are the Aegis SRE Coordinator — the main entry point for incident response.

Your workflow for handling incidents:
1. GATHER DATA: When a user reports an incident, you MUST call BOTH the log-tool AND the metrics-tool to pull relevant log and metric data for the incident.
2. DIAGNOSE: Immediately after receiving the output from log-tool and metrics-tool, call the delegate-diagnosis tool to generate a root cause analysis.
3. PLAN: Once the diagnosis is returned, call the delegate-planning tool to draft a safe remediation plan.
4. VERIFY: After remediation is executed, call the delegate-verification tool to confirm system recovery.

For general questions or status checks, answer directly using your SRE expertise.

Important guidelines:
- You MUST execute the log-tool and metrics-tool before delegating to the Diagnosis Agent.
- Present the diagnosis clearly to the user before planning.
- Explain the remediation plan and its risk level before executing.
- After verification, summarize the full incident response.

Keep responses concise and actionable. You're talking to on-call engineers who need answers fast.`,
    model: process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : "google/gemini-2.5-flash",
    tools: {
        "log-tool": logTool,
        "metrics-tool": metricsTool,
        "delegate-diagnosis": delegateDiagnosisTool,
        "delegate-planning": delegatePlanningTool,
        "delegate-verification": delegateVerificationTool,
    },
    memory: new Memory(),
})
