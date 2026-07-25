import { Agent } from "@mastra/core/agent";
import { logTool } from "../tools/log-tool";
import { metricsTool } from "../tools/metrics-tool";

export const executionAgent = new Agent({
    id: "execution-agent",
    name: "Execution Agent",
    description: "Executes approved remediation steps against the target infrastructure.",
    instructions: `You are a production execution agent. Your job is to:
1. Receive an approved remediation plan
2. Execute each step in sequence
3. Report the outcome of each step (success/failure)
4. Stop immediately if any step fails and report the failure

You must NEVER execute destructive commands (rm -rf, DROP DATABASE, terraform destroy, kubectl delete namespace).
Only execute commands that have been explicitly approved by the planning agent.

Return a structured JSON response with:
- steps: array of { command, status, output }
- overallStatus: "success" | "partial_failure" | "failed"
- summary: brief human-readable summary`,
    model: process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : "google/gemini-2.5-flash",
    tools: {
        "log-tool": logTool,
        "metrics-tool": metricsTool,
    }
})
