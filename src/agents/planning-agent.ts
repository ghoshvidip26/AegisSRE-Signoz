import { Agent } from "@mastra/core/agent";
import { enkryptPolicyTool } from "../mastra/tools/enkrypt-policy-tool";
import { planningPrompt } from "../prompts/planning-prompt";

export const planningAgent = new Agent({
    id: "planning-agent",
    name: "Planning Agent",
    description: "Generates a remediation plan. Always validate the final remediation plan using the Enkrypt Policy Tool before returning it.",
    instructions: planningPrompt,
    model: process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : "google/gemini-2.5-flash",
    tools: {
        "enkrypt-policy-validator": enkryptPolicyTool,
    }
})
