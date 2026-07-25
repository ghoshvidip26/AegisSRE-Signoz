import { Agent } from "@mastra/core/agent";
import { diagnosisPrompt } from "../prompts/diagnosis-prompt";
import { logTool } from "../tools/log-tool";
import { metricsTool } from "../tools/metrics-tool";

export const diagnosisAgent = new Agent({
    id: "diagnosis-agent",
    name: "Diagnosis Agent",
    description: "Analyzes production incidents and identifies the probable root cause.",
    instructions: diagnosisPrompt,
    model: process.env.OPENAI_API_KEY ? "openai/gpt-4o-mini" : "google/gemini-2.5-flash",
    tools: {
        "log-tool": logTool,
        "metrics-tool": metricsTool,
    }
})