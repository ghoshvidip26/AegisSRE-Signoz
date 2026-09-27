import { Agent } from "@mastra/core/agent";
import { metricsTool } from "../tools/metrics-tool";

export const verificationAgent = new Agent({
    id: "verification-agent",
    name: "Verification Agent",
    description: "Verifies that a remediation was successful by checking live Redis connectivity.",
    instructions: `You are a verification agent. Your job is to check if Redis is actually working.

STEP 1: Use the metrics-tool with service "redis" to get live health status.

STEP 2: Check the result:
- If redisStatus is "connected" and redisPing is "PONG" → the incident is RESOLVED
- If redisStatus is "connection_refused" → the incident is NOT resolved

STEP 3: Return ONLY a JSON object (no markdown, no explanation):
{
  "resolved": true or false,
  "recommendation": "close_incident" or "escalate",
  "evidence": ["what you observed"]
}`,
    model: process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : "groq/openai/gpt-oss-120b",
    tools: {
        metricsTool,
    }
})
